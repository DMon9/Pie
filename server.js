const express = require("express");
const fetch = require("node-fetch");
const Stripe = require("stripe");
const cors = require("cors");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(express.json());

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// 🏦 In-memory balances (replace with DB in production)
let balances = {};

// ✅ Health check
app.get("/", (req, res) => {
  res.send("✅ Pi Squared Backend is running with Stripe integration");
});

// ✅ Get balance by wallet
app.get("/api/balance/:wallet", (req, res) => {
  const wallet = req.params.wallet || "guest";
  res.json({ wallet, balance: balances[wallet] || 0 });
});

// ✅ Proxy NFL live scores
app.get("/api/nfl", async (req, res) => {
  try {
    const r = await fetch("https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=American%20Football");
    const data = await r.json();
    if (!data.events) {
      const upcoming = await fetch("https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4391");
      const upData = await upcoming.json();
      return res.json(upData);
    }
    res.json(data);
  } catch (err) {
    console.error("NFL fetch error:", err);
    res.status(500).json({ error: "Failed to fetch NFL scores" });
  }
});

// ✅ Dynamic Stripe checkout
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { wallet, amount } = req.body;
    if (!amount || amount < 100) {
      return res.status(400).json({ error: "Invalid deposit amount" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Deposit" },
            unit_amount: amount,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "https://pi2sports.netlify.app/success.html",
      cancel_url: "https://pi2sports.netlify.app/cancel.html",
      metadata: { wallet: wallet || "guest" }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Stripe webhook
app.post("/webhook", bodyParser.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const wallet = session.metadata.wallet || "guest";
    const amount = session.amount_total;

    if (!balances[wallet]) balances[wallet] = 0;
    balances[wallet] += amount / 100; // cents → dollars

    console.log(`💰 Credited ${wallet} with $${amount/100}`);
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
