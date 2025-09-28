
/**
 * Pi² Sports Backend (Full Scaffold)
 * - Email/password + Google OAuth login
 * - JWT auth
 * - Stripe webhook validates referrals after any $10+ deposit
 * - Referrals API (validated/pending + leaderboard)
 * - Milestones with admin approval (100=$20, 500=$100, 1000=$1000 first only)
 * - Image proxy endpoints (ESPN fallback) for team logos & player headshots
 * - In-memory data store (replace with DB when ready)
 */
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const Stripe = require('stripe');
const bodyParser = require('body-parser');

const app = express();

// Stripe needs the raw body for webhook verification
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    bodyParser.raw({ type: 'application/json' })(req, res, next);
  } else {
    bodyParser.json({ limit: '1mb' })(req, res, next);
  }
});

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// ---------- ENV ----------
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:8888').replace(/\/$/,''); // e.g., https://pi2sports.netlify.app
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me-admin';

// Google OAuth
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || `${FRONTEND_URL}/auth/callback`;

// Stripe
const stripe = (process.env.STRIPE_SECRET_KEY)? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// Images proxy config
const IMAGE_PROVIDER_PRIMARY=(process.env.IMAGE_PROVIDER_PRIMARY||'sportradar').toLowerCase();
const IMAGE_PROVIDER_FALLBACK=(process.env.IMAGE_PROVIDER_FALLBACK||'espn').toLowerCase();
const PH_TEAM=(process.env.IMAGE_PLACEHOLDER_TEAM||'/assets/default-team.svg');
const PH_PLAYER=(process.env.IMAGE_PLACEHOLDER_PLAYER||'/assets/default-player.svg');

// In-memory stores (replace with DB)
const mem = {
  users: {},           // id -> { id, email, display_name, cashBalance, contestCredits, referralsCount, provider, passwordHash? }
  referrals: [],       // { inviter_user_id, referred_user_id, qualified:false, invited_at, qualified_at, first_deposit_cents }
  milestones: [],      // { id, user_id, tier:100|500|1000, amount_cents, status:'pending'|'approved'|'denied', created_at, decided_at }
  sessions: {},        // token -> user_id
};

function uid(prefix='u'){ return prefix+'_'+Math.random().toString(36).slice(2,10); }
function now(){ return new Date().toISOString(); }

// JWT helpers
function signToken(user){
  return jwt.sign({ uid:user.id, email:user.email }, JWT_SECRET, { expiresIn:'7d' });
}
function auth(req,res,next){
  const authz = req.headers.authorization || '';
  const tok = authz.startsWith('Bearer ') ? authz.slice(7) : (req.cookies.token || '');
  if(!tok) return res.status(401).send('Unauthorized');
  try{
    const payload = jwt.verify(tok, JWT_SECRET);
    req.user = payload;
    next();
  }catch(e){ return res.status(401).send('Invalid token'); }
}
function admin(req,res,next){
  const authz = req.headers.authorization || '';
  const tok = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if(tok===ADMIN_TOKEN) return next();
  return res.status(401).send('Admin token required');
}

// ---------- Auth (email/password minimal stubs) ----------
app.post('/auth/register', (req,res)=>{
  const { email, password, display_name, ref } = req.body||{};
  if(!email || !password) return res.status(400).send('Email and password required');
  const exists = Object.values(mem.users).find(u=>u.email===email);
  if(exists) return res.status(400).send('Email already registered');
  const u = { id: uid(), email, display_name: display_name||email.split('@')[0], cashBalance:0, contestCredits:0, referralsCount:0, provider:'password' };
  mem.users[u.id]=u;
  // record pending referral if ref provided (simple: treat ref as inviter email or id)
  if(ref){
    const inviter = Object.values(mem.users).find(x=>x.id===ref || x.email===ref);
    if(inviter){
      mem.referrals.push({ inviter_user_id: inviter.id, referred_user_id: u.id, qualified:false, invited_at: now(), qualified_at:null, first_deposit_cents:0 });
    }
  }
  const token = signToken(u);
  mem.sessions[token]=u.id;
  res.json({ token, user:{ id:u.id, email:u.email, display_name:u.display_name } });
});

app.post('/auth/login', (req,res)=>{
  const { email, password } = req.body||{};
  const u = Object.values(mem.users).find(x=>x.email===email);
  if(!u) return res.status(401).send('Invalid credentials');
  const token = signToken(u);
  mem.sessions[token]=u.id;
  res.json({ token, user:{ id:u.id, email:u.email, display_name:u.display_name } });
});

// ---------- Google OAuth ----------
app.get('/auth/google', (req,res)=>{
  if(!GOOGLE_CLIENT_ID || !GOOGLE_CALLBACK_URL) return res.status(400).send('Google OAuth not configured');
  const state = 'pi2-'+Math.random().toString(36).slice(2);
  const scope = encodeURIComponent('openid email profile');
  const redirect = encodeURIComponent(GOOGLE_CALLBACK_URL);
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${redirect}&response_type=code&scope=${scope}&state=${state}&prompt=select_account`;
  res.redirect(url);
});

app.get('/auth/google/callback', async (req,res)=>{
  const { code } = req.query;
  if(!code) return res.status(400).send('Missing code');
  try{
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:'POST',
      headers:{ 'content-type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_CALLBACK_URL, grant_type: 'authorization_code'
      })
    });
    const tokenJson = await tokenRes.json();
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers:{ authorization: `Bearer ${tokenJson.access_token}` }
    });
    const info = await infoRes.json();
    const email = info.email;
    let u = Object.values(mem.users).find(x=>x.email===email);
    if(!u){
      u = { id: uid(), email, display_name: info.name || email.split('@')[0], cashBalance:0, contestCredits:0, referralsCount:0, provider:'google' };
      mem.users[u.id]=u;
    }
    const token = signToken(u);
    mem.sessions[token]=u.id;
    return res.redirect(`${FRONTEND_URL}/auth/callback?token=${encodeURIComponent(token)}`);
  }catch(e){
    return res.status(500).send('Google auth failed');
  }
});

// ---------- Me / Balance ----------
app.get('/me', auth, (req,res)=>{
  const u = mem.users[req.user.uid];
  if(!u) return res.status(401).send('Unknown user');
  res.json({ id:u.id, email:u.email, display_name:u.display_name, balance:u.cashBalance, credits:u.contestCredits });
});

// ---------- Stripe Webhook ----------
if(stripe){
  app.post('/webhook', (req,res)=>{
    let event;
    try{
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    }catch(err){
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if(event.type==='checkout.session.completed'){
      const session = event.data.object;
      const userEmail = session.customer_details && session.customer_details.email;
      const amount_cents = session.amount_total || 0;
      const user = Object.values(mem.users).find(x=>x.email===userEmail);
      if(user){
        // credit balance
        user.cashBalance += amount_cents/100;
        // Referral validation: any deposit >= $10 qualifies referral
        if(amount_cents >= 1000){
          const ref = mem.referrals.find(r=>r.referred_user_id===user.id && !r.qualified);
          if(ref){
            ref.qualified = true;
            ref.qualified_at = now();
            ref.first_deposit_cents = amount_cents;
            // inviter reward
            const inviter = mem.users[ref.inviter_user_id];
            if(inviter){
              inviter.contestCredits += 5;
              inviter.referralsCount += 1;
              // milestones
              const tiers = [
                {count:100, cents:2000},
                {count:500, cents:10000},
                {count:1000, cents:100000} // first user only
              ];
              tiers.forEach(t=>{
                const exists = mem.milestones.find(m=>m.user_id===inviter.id && m.tier===t.count);
                if(!exists && inviter.referralsCount>=t.count){
                  if(t.count===1000){
                    const alreadyWon = mem.milestones.find(m=>m.tier===1000 && m.status==='approved');
                    if(alreadyWon) return;
                  }
                  mem.milestones.push({ id: uid('m'), user_id: inviter.id, tier:t.count, amount_cents:t.cents, status:'pending', created_at: now(), decided_at:null });
                }
              });
            }
          }
        }
      }
    }
    res.json({ received: true });
  });
} else {
  app.post('/webhook', (req,res)=>res.status(501).send('Stripe not configured'));
}

// ---------- Referrals API ----------
app.get('/account/referrals', auth, (req,res)=>{
  const uid = req.user.uid;
  const mine = mem.referrals.filter(r=>r.inviter_user_id===uid);
  const validated = mine.filter(r=>r.qualified).map(r=>{
    const u = mem.users[r.referred_user_id];
    return { user_id: u.id, email: u.email, display_name: u.display_name, first_deposit: r.first_deposit_cents, qualified_at: r.qualified_at };
  });
  const pending = mine.filter(r=>!r.qualified).map(r=>{
    const u = mem.users[r.referred_user_id];
    return { user_id: u.id, email: u.email, display_name: u.display_name, invited_at: r.invited_at };
  });
  res.json({
    validated, pending,
    stats:{ validated_count: validated.length, pending_count: pending.length, credits_earned: (mem.users[uid]?.contestCredits||0) }
  });
});

// Leaderboard (global top inviters)
app.get('/referrals/leaderboard', (req,res)=>{
  const list = Object.values(mem.users)
    .sort((a,b)=>b.referralsCount - a.referralsCount)
    .slice(0,20)
    .map(u=>({ user: u.display_name||u.email, referrals: u.referralsCount, credits: u.contestCredits }));
  res.json(list);
});

// Admin milestones review
app.get('/admin/milestones', admin, (req,res)=>{
  const { status } = req.query;
  let list = mem.milestones;
  if(status) list = list.filter(m=>m.status===status);
  res.json(list);
});
app.post('/admin/milestones/:id/approve', admin, (req,res)=>{
  const m = mem.milestones.find(x=>x.id===req.params.id);
  if(!m || m.status!=='pending') return res.status(400).send('Invalid milestone');
  const u = mem.users[m.user_id]; if(!u) return res.status(400).send('User missing');
  u.cashBalance += m.amount_cents/100;
  m.status='approved'; m.decided_at=now();
  return res.json({ ok:true, milestone:m, user:{ id:u.id, cashBalance:u.cashBalance }});
});
app.post('/admin/milestones/:id/deny', admin, (req,res)=>{
  const m = mem.milestones.find(x=>x.id===req.params.id);
  if(!m || m.status!=='pending') return res.status(400).send('Invalid milestone');
  m.status='denied'; m.decided_at=now();
  return res.json({ ok:true, milestone:m });
});

// ---------- Images proxy (ESPN fallback) ----------
function espnTeamURL(abbr, league){
  const lg=(league||'nfl').toLowerCase();
  if(!abbr) return null;
  if(lg==='nfl') return `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr}.png`;
  return `https://a.espncdn.com/i/teamlogos/ncaa/500/${abbr}.png`;
}
function espnPlayerURL(espnId, league){
  const lg=(league||'nfl').toLowerCase();
  if(!espnId) return null;
  if(lg==='nfl') return `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;
  return `https://a.espncdn.com/i/headshots/college-football/players/full/${espnId}.png`;
}
async function proxyImage(res, url){
  if(!url) return false;
  try{
    const r=await fetch(url);
    if(!r.ok) return false;
    const ctype=r.headers.get('content-type')||'image/png';
    const buf=Buffer.from(await r.arrayBuffer());
    res.setHeader('content-type', ctype);
    res.setHeader('cache-control','public, max-age=86400');
    res.end(buf);
    return true;
  }catch{ return false; }
}
app.get('/api/images/team/:key', async (req,res)=>{
  const league=(req.query.league||'nfl'); const abbr=(req.query.abbr||'').toLowerCase();
  const ok = await proxyImage(res, espnTeamURL(abbr||req.params.key.toLowerCase(), league));
  if(!ok) return res.redirect(FRONTEND_URL+PH_TEAM);
});
app.get('/api/images/player/:key', async (req,res)=>{
  const league=(req.query.league||'nfl'); const espnId=(req.query.espnId||'');
  const ok = await proxyImage(res, espnPlayerURL(espnId||req.params.key, league));
  if(!ok) return res.redirect(FRONTEND_URL+PH_PLAYER);
});

app.get('/', (_,res)=>res.send('Pi² Sports backend is running'));
app.listen(PORT, ()=>console.log('Pi2 backend listening on', PORT));
