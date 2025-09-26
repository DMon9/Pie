const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

// ⚠️ Webhook must use raw body
app.post("/webhook", express.raw({ type: "application/json" }), webhookHandler);

// Normal JSON for other routes
app.use(cors({ origin: "*"}));
app.use(express.json());

// Env
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://pi2sports.netlify.app").replace(/\/$/, "");
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Postgres
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
      type TEXT CHECK (type IN ('deposit', 'withdraw')) NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("✅ DB ready");
}
initDb().catch(e => console.error("DB init error:", e));

// Helpers
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
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Routes
app.get("/", (req, res) => {
  res.send("✅ Pi2Sports backend with auth is running");
});

// Register
app.post("/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email & password required" });
  try {
    const hash = await bcrypt.hash(password, 10);
    const q = await pool.query("INSERT INTO users(email, password) VALUES($1,$2) RETURNING id, email, balance", [email, hash]);
    const user = q.rows[0];
    const token = signToken(user);
    res.json({ user, token });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Email already registered" });
    console.error("Register error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email & password required" });
  try {
    const q = await pool.query("SELECT id, email, password, balance FROM users WHERE email=$1", [email]);
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

// Protected: balance
app.get("/me/balance", auth, async (req, res) => {
  try {
    const q = await pool.query("SELECT balance FROM users WHERE id=$1", [req.user.id]);
    res.json({ balance: parseFloat(q.rows[0]?.balance || 0) });
  } catch (e) {
    console.error("Balance error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Protected: create checkout session for deposit
app.post("/api/create-checkout-session", auth, async (req, res) => {
  try {
    const { amount } = req.body || {};
    if (!Number.isInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: "Amount must be integer cents > 0" });
    }
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Pi² Sports Deposit" },
          unit_amount: amount
        },
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

// Protected: withdraw request
app.post("/me/withdraw-request", auth, async (req, res) => {
  const { amount } = req.body || {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Invalid amount" });
  try {
    const uq = await pool.query("SELECT balance FROM users WHERE id=$1", [req.user.id]);
    const bal = parseFloat(uq.rows[0]?.balance || 0);
    if (bal < Number(amount)) return res.status(400).json({ error: "Insufficient balance" });
    await pool.query("UPDATE users SET balance = balance - $1 WHERE id=$2", [amount, req.user.id]);
    await pool.query("INSERT INTO transactions(user_id, amount, type, status) VALUES($1,$2,'withdraw','pending')",
      [req.user.id, amount]);
    res.json({ success: true });
  } catch (e) {
    console.error("Withdraw error:", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Webhook (defined above with raw)
async function webhookHandler(req, res) {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    if (!endpointSecret) {
      console.warn("⚠️ No STRIPE_WEBHOOK_SECRET set; skipping verification.");
      event = JSON.parse(req.body);
    } else {
      event = Stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    }
  } catch (err) {
    console.error("Webhook signature verify failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const userId = parseInt(session.metadata?.user_id || "0", 10);
    const amount = (session.amount_total || 0) / 100.0; // convert to dollars
    if (userId && amount > 0) {
      try {
        await pool.query("UPDATE users SET balance = balance + $1 WHERE id=$2", [amount, userId]);
        await pool.query("INSERT INTO transactions(user_id, amount, type, status) VALUES($1,$2,'deposit','completed')",
          [userId, amount]);
        console.log(`💰 Credited user ${userId} with $${amount.toFixed(2)}`);
      } catch (e) {
        console.error("Webhook DB error:", e);
      }
    }
  }

  res.json({ received: true });
}

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
