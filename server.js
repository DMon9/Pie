const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");

const app = express();

// Stripe webhook must get raw body:
app.post("/webhook", express.raw({ type: "application/json" }), webhookHandler);

// Normal JSON middleware for all other routes:
app.use(cors({ origin: "*" }));
app.use(express.json());

// Env
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://pi2sports.netlify.app").replace(/\/$/, "");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();
const RAKE_PCT = Number(process.env.PLATFORM_RAKE_PCT || "0.07");
const ODDS_API_KEY = process.env.ODDS_API_KEY || "";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// --- DB bootstrap ---
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      balance NUMERIC DEFAULT 0
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      amount NUMERIC NOT NULL,
      type TEXT CHECK (type IN ('deposit','withdraw','platform_fee')) NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contests (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      sport TEXT NOT NULL,
      entry_fee NUMERIC NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', -- open|closed|settled
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contest_entries (
      id SERIAL PRIMARY KEY,
      contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (contest_id, user_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_revenue (
      id SERIAL PRIMARY KEY,
      contest_id INTEGER REFERENCES contests(id) ON DELETE SET NULL,
      amount NUMERIC NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("✅ DB ready");
}
initDb().catch(e => console.error("DB init error:", e));

// --- Helpers ---
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const [, token] = h.split(" ");
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
function isAdmin(req) {
  return (req.user?.email || "").toLowerCase() === ADMIN_EMAIL;
}

// --- Basic ---
app.get("/", (req, res) => res.send("✅ Pi2Sports backend (Auth + Stripe + Contests + Odds)"));

// --- Auth ---
app.post("/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email & password required" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const q = await pool.query("INSERT INTO users(email, password) VALUES($1,$2) RETURNING id, email, balance", [email.toLowerCase(), hash]);
    const user = q.rows[0];
    const token = signToken(user);
    res.json({ user, token });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Email already registered" });
    console.error("Register error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email & password required" });
  try {
    const q = await pool.query("SELECT * FROM users WHERE email=$1", [email.toLowerCase()]);
    if (!q.rows.length) return res.status(400).json({ error: "Invalid credentials" });
    const user = q.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: "Invalid credentials" });
    const token = signToken(user);
    res.json({ user: { id: user.id, email: user.email, balance: user.balance }, token });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Balance ---
app.get("/me/balance", auth, async (req, res) => {
  try {
    const q = await pool.query("SELECT balance FROM users WHERE id=$1", [req.user.id]);
    res.json({ balance: Number(q.rows[0]?.balance || 0) });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

// --- Stripe Checkout (Deposit) ---
app.post("/api/create-checkout-session", auth, async (req, res) => {
  try {
    const { amount } = req.body || {};
    if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: "Amount must be integer cents > 0" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: { currency: "usd", product_data: { name: "Pi² Sports Deposit" }, unit_amount: amount },
        quantity: 1
      }],
      success_url: FRONTEND_URL + "/success.html",
      cancel_url: FRONTEND_URL + "/cancel.html",
      metadata: { user_id: String(req.user.id) }
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("Create session error:", e);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

async function webhookHandler(req, res) {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    if (!endpointSecret) {
      event = JSON.parse(req.body);
    } else {
      event = Stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    }
  } catch (err) {
    console.error("Webhook verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = parseInt(session.metadata?.user_id || "0", 10);
    const amount = (session.amount_total || 0) / 100.0;
    if (userId && amount > 0) {
      try {
        await pool.query("UPDATE users SET balance = balance + $1 WHERE id=$2", [amount, userId]);
        await pool.query("INSERT INTO transactions(user_id, amount, type, status) VALUES($1,$2,'deposit','completed')",
          [userId, amount]);
        console.log(`💰 Credited user ${userId} with $${amount}`);
      } catch (e) {
        console.error("Webhook DB error:", e);
      }
    }
  }

  res.json({ received: true });
}

// --- Contests public ---
app.get("/contests", async (req, res) => {
  const status = req.query.status || "open";
  try {
    const q = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM contest_entries e WHERE e.contest_id=c.id) AS entrants
       FROM contests c
       WHERE c.status=$1
       ORDER BY c.created_at DESC`, [status]);
    res.json(q.rows);
  } catch (e) {
    console.error("List contests error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/contests/:id/enter", auth, async (req, res) => {
  const { id } = req.params;
  try {
    const cq = await pool.query("SELECT * FROM contests WHERE id=$1", [id]);
    const contest = cq.rows[0];
    if (!contest) return res.status(404).json({ error: "Contest not found" });
    if (contest.status !== "open") return res.status(400).json({ error: "Contest not open" });

    const uq = await pool.query("SELECT balance FROM users WHERE id=$1", [req.user.id]);
    const bal = Number(uq.rows[0]?.balance || 0);
    const fee = Number(contest.entry_fee);
    if (bal < fee) return res.status(400).json({ error: "Insufficient balance" });

    await pool.query("UPDATE users SET balance = balance - $1 WHERE id=$2", [fee, req.user.id]);
    await pool.query("INSERT INTO contest_entries(contest_id, user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [contest.id, req.user.id]);

    res.json({ success: true });
  } catch (e) {
    console.error("Enter contest error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// --- Admin contest management ---
app.post("/admin/contests", auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admins only" });
  const { title, sport, entry_fee } = req.body || {};
  if (!title || !sport || !entry_fee) return res.status(400).json({ error: "Missing fields" });
  try {
    const q = await pool.query(
      "INSERT INTO contests(title, sport, entry_fee, created_by) VALUES($1,$2,$3,$4) RETURNING *",
      [title, sport, entry_fee, req.user.id]
    );
    res.json(q.rows[0]);
  } catch (e) {
    console.error("Create contest error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/admin/contests/:id", auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admins only" });
  const { id } = req.params;
  const { title, sport, entry_fee, status } = req.body || {};
  try {
    const q = await pool.query(
      `UPDATE contests
       SET title=COALESCE($1,title), sport=COALESCE($2,sport),
           entry_fee=COALESCE($3,entry_fee), status=COALESCE($4,status)
       WHERE id=$5 RETURNING *`,
      [title, sport, entry_fee, status, id]
    );
    res.json(q.rows[0] || {});
  } catch (e) {
    console.error("Update contest error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/admin/contests/:id", auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admins only" });
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM contests WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (e) {
    console.error("Delete contest error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/admin/contests/:id/settle", auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admins only" });
  const { id } = req.params;
  const { winners } = req.body || {};
  if (!Array.isArray(winners) || winners.length === 0) {
    return res.status(400).json({ error: "Provide winners array (emails)" });
  }
  try {
    const cq = await pool.query("SELECT * FROM contests WHERE id=$1", [id]);
    const contest = cq.rows[0];
    if (!contest) return res.status(404).json({ error: "Contest not found" });
    if (contest.status === "settled") return res.status(400).json({ error: "Already settled" });

    const eq = await pool.query("SELECT COUNT(*)::int AS n FROM contest_entries WHERE contest_id=$1", [id]);
    const entrants = Number(eq.rows[0]?.n || 0);
    const totalPool = entrants * Number(contest.entry_fee);

    const rake = +(totalPool * RAKE_PCT).toFixed(2);
    const prizePool = +(totalPool - rake).toFixed(2);
    const perWinner = +(prizePool / winners.length).toFixed(2);

    for (const email of winners) {
      const uq = await pool.query("SELECT id FROM users WHERE email=$1", [email.toLowerCase()]);
      if (!uq.rows.length) continue;
      const uid = uq.rows[0].id;
      await pool.query("UPDATE users SET balance = balance + $1 WHERE id=$2", [perWinner, uid]);
      await pool.query("INSERT INTO transactions(user_id, amount, type, status) VALUES($1,$2,'deposit','completed')",
        [uid, perWinner]);
    }

    await pool.query("INSERT INTO platform_revenue(contest_id, amount) VALUES($1,$2)", [contest.id, rake]);
    await pool.query("INSERT INTO transactions(user_id, amount, type, status) VALUES(NULL,$1,'platform_fee','earned')", [rake]);
    await pool.query("UPDATE contests SET status='settled' WHERE id=$1", [id]);

    res.json({ success: true, entrants, totalPool, rake, prizePool, perWinner });
  } catch (e) {
    console.error("Settle contest error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// --- College Football via TheOddsAPI ---
app.get("/games/college-football", async (req, res) => {
  if (!ODDS_API_KEY) return res.status(500).json({ error: "Missing ODDS_API_KEY" });
  try {
    const url = `https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,totals&oddsFormat=american`;
    const resp = await fetch(url);
    const data = await resp.json();
    const upcoming = (Array.isArray(data) ? data : []).map(g => ({
      id: g.id,
      commence_time: g.commence_time,
      home_team: g.home_team,
      away_team: g.away_team
    }));
    res.json(upcoming);
  } catch (e) {
    console.error("CFB odds error:", e);
    res.status(500).json({ error: "Failed to fetch games" });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

