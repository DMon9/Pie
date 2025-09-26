const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY); // Set in Render
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ✅ Health check route
app.get("/", (req, res) => {
  res.send("✅ Pi2Sports backend is running in Live Mode");
});

// ✅ Deposit (Stripe Checkout)
app.post("/api/create-checkout-session", async (req, res) => {
  try {
    const { wallet, amount } = req.body;
    if (!amount || amount < 100) {
      return res.status(400).json({ error: "Invalid deposit amount" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: "Deposit" },
          unit_amount: amount,
        },
        quantity: 1
      }],
      mode: "payment",
      success_url: process.env.FRONTEND_URL + "/success.html",
      cancel_url: process.env.FRONTEND_URL + "/cancel.html",
      metadata: { wallet: wallet || "guest" }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ✅ Webhook for Stripe events
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    console.log("💰 Payment successful for wallet:", session.metadata.wallet);
  }

  res.json({ received: true });
});

// ✅ Withdraw request logger
let withdrawals = [];
let balances = {};

app.post("/api/withdraw-request", (req, res) => {
  const { wallet, amount, destination } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: "Invalid withdrawal amount" });
  }

  if (!balances[wallet] || balances[wallet] < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  balances[wallet] -= amount;

  const request = {
    id: withdrawals.length + 1,
    wallet,
    amount,
    destination,
    status: "pending",
    created: new Date()
  };
  withdrawals.push(request);

  console.log("💸 Withdrawal requested:", request);

  res.json({ success: true, message: "Withdrawal request logged", request });
});

app.get("/api/withdraw-requests", (req, res) => {
  res.json(withdrawals);
});

app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));
