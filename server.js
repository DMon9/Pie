
/**
 * UBet Backend ADMIN build
 * - Adds Admin API with token auth for CRUD contests & markets
 * - Adds props picker stubs + search (returns sample data w/o provider key)
 * - Keeps all PLUS features (stripe, usdc, odds, picks)
 */
const express=require('express');
const cors=require('cors');
const cookieParser=require('cookie-parser');
const bodyParser=require('body-parser');
const {Pool}=require('pg');
const Stripe=require('stripe');
const fetch=require('node-fetch');
const {ethers}=require('ethers');
const cron=require('node-cron');
const app=express();

app.post('/webhook', express.raw({type:'application/json'}), webhookHandler);

app.use(cors({origin:true, credentials:true}));
app.use(cookieParser());
app.use(bodyParser.json());

const PORT=process.env.PORT||3000;
const FRONTEND_URL=(process.env.FRONTEND_URL||'').replace(/\/$/,'');
const ADMIN_EMAIL=(process.env.ADMIN_EMAIL||'').toLowerCase();
const ADMIN_TOKEN=process.env.ADMIN_TOKEN||'';
const PLATFORM_RAKE_PCT=Number(process.env.PLATFORM_RAKE_PCT||'0.07');
const DATABASE_URL=process.env.DATABASE_URL;

// Stripe
const stripe=process.env.STRIPE_SECRET_KEY?Stripe(process.env.STRIPE_SECRET_KEY):null;
const STRIPE_ENDPOINT_SECRET=process.env.STRIPE_WEBHOOK_SECRET||'';

// Odds API
const ODDS_API_KEY=process.env.ODDS_API_KEY||'';
// Props provider (placeholder)
const SPORTRADAR_API_KEY=process.env.SPORTRADAR_API_KEY||'';

// Chains
const CHAINS = {
  ethereum: { chainId:1, rpc:process.env.ETHEREUM_RPC_URL||'', usdc: process.env.USDC_ETH||'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
  polygon: { chainId:137, rpc:process.env.POLYGON_RPC_URL||'', usdc: process.env.USDC_POLY||'0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' },
  arbitrum:{ chainId:42161, rpc:process.env.ARBITRUM_RPC_URL||'', usdc: process.env.USDC_ARB||'0xaf88d065e77c8cC2239327C5EDb3A432268e5831' }
};
const ADMIN_PRIVATE_KEY=process.env.ADMIN_PRIVATE_KEY||'';

const providers={}, signers={}, usdcs={}, houses={};
const erc20Abi=[
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 value) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];
const {ethers: ethersNS}=require('ethers');
for(const k of Object.keys(CHAINS)){
  const cfg=CHAINS[k];
  if(cfg.rpc && ADMIN_PRIVATE_KEY){
    providers[k]=new ethersNS.providers.JsonRpcProvider(cfg.rpc);
    signers[k]=new ethersNS.Wallet(ADMIN_PRIVATE_KEY, providers[k]);
    houses[k]=signers[k].address;
    usdcs[k]=new ethersNS.Contract(cfg.usdc, erc20Abi, signers[k]);
  }
}

const pool=new Pool({connectionString:DATABASE_URL, ssl: DATABASE_URL?.includes('render.com')?{rejectUnauthorized:false}:false});

const payoutMatrix={2:{standard:4,flex1:null,flex2:null},3:{standard:8,flex1:2,flex2:null},4:{standard:15,flex1:5,flex2:1.2},5:{standard:30,flex1:10,flex2:3},6:{standard:60,flex1:20,flex2:5},7:{standard:100,flex1:35,flex2:10}};

async function migrate(){
  await pool.query('CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,email TEXT UNIQUE,balance NUMERIC DEFAULT 0,eth_address TEXT,created_at TIMESTAMP DEFAULT NOW())');
  await pool.query('CREATE TABLE IF NOT EXISTS transactions(id SERIAL PRIMARY KEY,user_id INTEGER,amount NUMERIC,type TEXT,status TEXT,meta JSONB,created_at TIMESTAMP DEFAULT NOW())');
  await pool.query(`CREATE TABLE IF NOT EXISTS contests(
    id SERIAL PRIMARY KEY,title TEXT,sport TEXT,entry_fee NUMERIC,status TEXT DEFAULT 'open',
    created_by INTEGER,created_at TIMESTAMP DEFAULT NOW(),game_id TEXT,market TEXT,selection TEXT,odds NUMERIC,
    max_entries INTEGER, rake_pct NUMERIC, prize_split JSONB)`);
  await pool.query('CREATE TABLE IF NOT EXISTS contest_entries(id SERIAL PRIMARY KEY,contest_id INTEGER,user_id INTEGER,created_at TIMESTAMP DEFAULT NOW(), UNIQUE(contest_id,user_id))');
  await pool.query('CREATE TABLE IF NOT EXISTS platform_revenue(id SERIAL PRIMARY KEY,source TEXT,source_id TEXT,amount NUMERIC,created_at TIMESTAMP DEFAULT NOW())');
  await pool.query('CREATE TABLE IF NOT EXISTS pick_entries(id SERIAL PRIMARY KEY,user_id INTEGER,stake NUMERIC,total_picks INTEGER,flex BOOLEAN DEFAULT false,status TEXT DEFAULT \'open\',payout NUMERIC,created_at TIMESTAMP DEFAULT NOW())');
  await pool.query('CREATE TABLE IF NOT EXISTS pick_selections(id SERIAL PRIMARY KEY,entry_id INTEGER,label TEXT,side TEXT,line NUMERIC,sport TEXT,game_id TEXT,correct BOOLEAN,prop_ref TEXT)');
  await pool.query('CREATE TABLE IF NOT EXISTS crypto_transfers(id SERIAL PRIMARY KEY,user_id INTEGER,chain TEXT,tx_hash TEXT,direction TEXT,amount NUMERIC,token TEXT DEFAULT \'USDC\',status TEXT,created_at TIMESTAMP DEFAULT NOW())');
}
migrate().catch(console.error);

async function meUser(req){ const email=String(req.cookies?.email||'').toLowerCase(); if(!email) return null; const q=await pool.query('SELECT * FROM users WHERE email=$1',[email]); return q.rows[0]||null; }
async function auth(req,res,next){ const u=await meUser(req); if(!u) return res.status(401).json({error:'login'}); req.user=u; next(); }
function adminAuth(req,res,next){
  const token = (req.headers.authorization||'').replace('Bearer ','').trim();
  if(!ADMIN_TOKEN || token!==ADMIN_TOKEN) return res.status(401).json({error:'adminUnauthorized'});
  next();
}

// base
app.get('/',(req,res)=>res.send('UBet Backend ADMIN ready'));
app.get('/config',(req,res)=>res.json({houses, rakePct: PLATFORM_RAKE_PCT, payoutMatrix, chains: Object.keys(CHAINS)}));
app.get('/picks/matrix',(req,res)=>res.json(payoutMatrix));

// login & me
app.post('/login-dev', async (req,res)=>{
  const email=String(req.body?.email||'').toLowerCase();
  if(!email) return res.status(400).json({error:'email'});
  let q=await pool.query('SELECT * FROM users WHERE email=$1',[email]);
  if(!q.rows.length){ q=await pool.query('INSERT INTO users(email,balance) VALUES($1,0) RETURNING *',[email]); }
  res.cookie('email',email,{httpOnly:false,sameSite:'lax'});
  res.json({ok:true});
});
app.get('/me', auth, async (req,res)=>{
  res.json({email:req.user.email,balance:Number(req.user.balance||0),eth_address:req.user.eth_address||null,houses});
});

// Stripe
app.post('/api/create-checkout-session', auth, async (req,res)=>{
  try{
    if(!stripe) return res.status(500).json({error:'Stripe not configured'});
    const amt=Number(req.body?.amount||0);
    const cents=Math.round(amt*100);
    const session=await stripe.checkout.sessions.create({
      mode:'payment',
      payment_method_types:['card'],
      line_items:[{price_data:{currency:'usd',product_data:{name:'UBet Deposit'},unit_amount:cents},quantity:1}],
      success_url:FRONTEND_URL?`${FRONTEND_URL}/success.html`:'https://example.com/success',
      cancel_url:FRONTEND_URL?`${FRONTEND_URL}/cancel.html`:'https://example.com/cancel',
      metadata:{user_email:req.user.email}
    });
    res.json({url:session.url});
  }catch(e){ console.error(e); res.status(500).json({error:'stripe failed'}); }
});
async function webhookHandler(req,res){
  if(!stripe) return res.json({received:true});
  let event; try{
    event= STRIPE_ENDPOINT_SECRET? Stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_ENDPOINT_SECRET): JSON.parse(req.body);
  }catch(e){ return res.status(400).send('bad sig'); }
  if(event.type==='checkout.session.completed'){
    const s=event.data.object; const email=String(s.metadata?.user_email||'').toLowerCase(); const amount=(s.amount_total||0)/100;
    if(email && amount>0){
      await pool.query('UPDATE users SET balance=balance+$1 WHERE email=$2',[amount,email]);
      const u=await pool.query('SELECT id FROM users WHERE email=$1',[email]);
      await pool.query('INSERT INTO transactions(user_id,amount,type,status,meta) VALUES($1,$2,\'deposit\',\'completed\',$3)',[u.rows[0]?.id||null,amount,{session:s.id}]);
    }
  }
  res.json({received:true});
}

// Crypto
const {utils}=require('ethers');
app.post('/crypto/link-wallet', auth, async (req,res)=>{
  const addr=String(req.body?.address||''); 
  try{ if(!utils.isAddress(addr)) return res.status(400).json({error:'bad address'}); }catch{ return res.status(400).json({error:'bad address'}); }
  await pool.query('UPDATE users SET eth_address=$1 WHERE id=$2',[addr,req.user.id]);
  res.json({linked:true,address:addr,houses});
});
app.get('/crypto/deposit-info', auth, (req,res)=>{
  const chain=(req.query.chain||'ethereum').toLowerCase();
  const house=houses[chain];
  if(!house) return res.status(400).json({error:'chain not configured'});
  res.json({token:'USDC',house,decimals:6,chain});
});
app.post('/crypto/withdraw', auth, async (req,res)=>{
  try{
    const chain=(req.body?.chain||'ethereum').toLowerCase();
    const usdc=usdcs[chain], signer=signers[chain];
    if(!usdc||!signer) return res.status(500).json({error:'crypto not configured for chain'});
    const amount=Number(req.body?.amount||0);
    const to=req.body?.to||req.user.eth_address;
    if(!(amount>0) || !utils.isAddress(to)) return res.status(400).json({error:'amount/address'});
    const qb=await pool.query('SELECT balance FROM users WHERE id=$1',[req.user.id]);
    const bal=Number(qb.rows[0]?.balance||0);
    if(bal<amount) return res.status(400).json({error:'insufficient'});
    const value = Math.round(amount*1e6);
    const tx = await usdc.transfer(to, value);
    await pool.query('UPDATE users SET balance=balance-$1 WHERE id=$2',[amount, req.user.id]);
    await pool.query('INSERT INTO crypto_transfers(user_id,chain,tx_hash,direction,amount,status) VALUES($1,$2,$3,\'withdraw\',$4,\'pending\')',[req.user.id,chain,tx.hash,amount]);
    res.json({txHash: tx.hash, chain});
  }catch(e){ console.error(e); res.status(500).json({error:'withdraw failed'}); }
});

// Odds API
function sportKey(nfl){return nfl?'americanfootball_nfl':'americanfootball_ncaaf';}
async function fetchOddsList(nfl){
  const url=`https://api.the-odds-api.com/v4/sports/${sportKey(nfl)}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,totals&oddsFormat=american`;
  const r=await fetch(url); return r.json();
}
async function fetchScores(nfl){
  const url=`https://api.the-odds-api.com/v4/sports/${sportKey(nfl)}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;
  const r=await fetch(url); return r.json();
}
app.get('/games/:league', async (req,res)=>{
  try{ const nfl=req.params.league.toLowerCase()==='nfl'; const data=await fetchOddsList(nfl); const out=(Array.isArray(data)?data:[]).map(g=>({id:g.id,commence_time:g.commence_time,home_team:g.home_team,away_team:g.away_team})); res.json(out);}catch(e){res.status(500).json({error:'fetch failed'});}
});
app.get('/games/:id/odds', async (req,res)=>{
  try{ const nfl=String(req.query.nfl||'1')==='1'; const data=await fetchOddsList(nfl); const game=(Array.isArray(data)?data:[]).find(g=>g.id===req.params.id); if(!game) return res.status(404).json({error:'not found'}); const b=game.bookmakers&&game.bookmakers[0]; const markets={moneyline:[], total:[]}; if(b&&Array.isArray(b.markets)){ for(const m of b.markets){ if(m.key==='h2h')(m.outcomes||[]).forEach(o=>markets.moneyline.push({name:o.name,price:o.price})); if(m.key==='totals')(m.outcomes||[]).forEach(o=>markets.total.push({name:o.name,point:o.point,price:o.price})); } } res.json({id:game.id,home:game.home_team,away:game.away_team,markets}); }catch(e){ res.status(500).json({error:'odds failed'}); }
});

// Picks
app.post('/picks/entries', auth, async (req,res)=>{
  try{
    const picks=req.body?.picks||[]; const stake=Number(req.body?.stake||0); const flex=!!req.body?.flex;
    if(!Array.isArray(picks) || picks.length<2 || picks.length>7) return res.status(400).json({error:'2-7 picks'});
    if(!(stake>0)) return res.status(400).json({error:'stake'});
    const u=await pool.query('SELECT balance FROM users WHERE id=$1',[req.user.id]); const bal=Number(u.rows[0]?.balance||0); if(bal<stake) return res.status(400).json({error:'insufficient'});
    await pool.query('UPDATE users SET balance=balance-$1 WHERE id=$2',[stake, req.user.id]);
    const ent=await pool.query('INSERT INTO pick_entries(user_id,stake,total_picks,flex,status) VALUES($1,$2,$3,$4,\'open\') RETURNING *',[req.user.id, stake, picks.length, flex]);
    for(const p of picks){
      await pool.query('INSERT INTO pick_selections(entry_id,label,side,line,sport,game_id,prop_ref) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [ent.rows[0].id, p.label, p.side, p.line, p.sport||'nfl', p.game_id||null, p.prop_ref||null]);
    }
    res.json({id:ent.rows[0].id});
  }catch(e){ console.error(e); res.status(500).json({error:'failed'}); }
});

// Admin CRUD
app.get('/admin/contests', adminAuth, async (req,res)=>{
  const q=await pool.query('SELECT * FROM contests ORDER BY id DESC'); res.json(q.rows);
});
app.post('/admin/contests', adminAuth, async (req,res)=>{
  const c=req.body||{};
  const ins=await pool.query(`INSERT INTO contests(title,sport,entry_fee,status,game_id,market,selection,odds,max_entries,rake_pct,prize_split,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [c.title,c.sport,c.entry_fee,c.status||'open',c.game_id||null,c.market||null,c.selection||null,c.odds||null,c.max_entries||null,c.rake_pct||PLATFORM_RAKE_PCT,c.prize_split||{type:'winner-take-all'},0]);
  res.json(ins.rows[0]);
});
app.patch('/admin/contests/:id', adminAuth, async (req,res)=>{
  const id=req.params.id; const c=req.body||{};
  const up=await pool.query(`UPDATE contests SET title=COALESCE($1,title), sport=COALESCE($2,sport), entry_fee=COALESCE($3,entry_fee),
    status=COALESCE($4,status), game_id=COALESCE($5,game_id), market=COALESCE($6,market), selection=COALESCE($7,selection),
    odds=COALESCE($8,odds), max_entries=COALESCE($9,max_entries), rake_pct=COALESCE($10,rake_pct), prize_split=COALESCE($11,prize_split) WHERE id=$12 RETURNING *`,
    [c.title,c.sport,c.entry_fee,c.status,c.game_id,c.market,c.selection,c.odds,c.max_entries,c.rake_pct,c.prize_split,id]);
  res.json(up.rows[0]);
});
app.delete('/admin/contests/:id', adminAuth, async (req,res)=>{
  await pool.query('DELETE FROM contests WHERE id=$1',[req.params.id]); res.json({ok:true});
});

// Props sample/search
const SAMPLE_PROPS=[
  {id:'p1', player:'Patrick Mahomes', team:'KC', market:'Pass Yds', line:285.5, opp:'BUF', sport:'nfl'},
  {id:'p2', player:'Travis Kelce', team:'KC', market:'Rec Yds', line:74.5, opp:'BUF', sport:'nfl'},
  {id:'p3', player:'Caleb Williams', team:'USC', market:'Pass TDs', line:2.5, opp:'UCLA', sport:'cfb'}
];
app.get('/props/:league/search', async (req,res)=>{
  const q=(req.query.q||'').toLowerCase();
  const lg=req.params.league.toLowerCase();
  const out=SAMPLE_PROPS.filter(p=>p.sport===lg && (!q || p.player.toLowerCase().includes(q)));
  res.json(out);
});

// Cron scan + settle (same as PLUS, minimized)
async function scanChain(chain){
  try{
    const usdc=usdcs[chain], provider=providers[chain], house=houses[chain];
    if(!usdc||!provider||!house) return;
    const latest=await provider.getBlockNumber();
    const fromBlock=Math.max(0, latest-2500);
    const filter=usdc.filters.Transfer(null, house);
    const logs=await usdc.queryFilter(filter, fromBlock, latest);
    for(const log of logs){
      const from=log.args[0]; const value=Number(log.args[2].toString())/1e6;
      const ex=await pool.query('SELECT 1 FROM crypto_transfers WHERE tx_hash=$1',[log.transactionHash]);
      if(ex.rows.length) continue;
      const u=await pool.query('SELECT id FROM users WHERE LOWER(eth_address)=LOWER($1)',[from]);
      const uid=u.rows[0]?.id;
      await pool.query('INSERT INTO crypto_transfers(user_id,chain,tx_hash,direction,amount,status) VALUES($1,$2,$3,\'deposit\',$4,$5)',
        [uid||null,chain,log.transactionHash,value, uid?'completed':'unmatched']);
      if(uid){
        await pool.query('UPDATE users SET balance=balance+$1 WHERE id=$2',[value, uid]);
        await pool.query('INSERT INTO transactions(user_id,amount,type,status,meta) VALUES($1,$2,\'deposit-usdc\',\'completed\',$3)',
          [uid,value,{tx:log.transactionHash,chain}]);
      }
    }
  }catch(e){ console.error('scanChain', chain, e.message); }
}
async function scanDeposits(){ for(const c of Object.keys(CHAINS)) await scanChain(c); }
cron.schedule('*/1 * * * *', scanDeposits);

app.listen(PORT, ()=>console.log('Backend ADMIN up on',PORT));
