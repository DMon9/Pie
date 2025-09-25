const express = require("express");
const fetch = require("node-fetch");
const Stripe = require("stripe");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Stripe setup (Render → Environment Variable → STRIPE_SECRET_KEY)
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ✅ Health check
app.get("/", (req, res) => {
  res.send("✅ Pi Squared Backend is running");
});

// ✅ Proxy NFL live scores
app.get("/api/nfl", async (req, res) => {
  try {
    const r = await fetch("https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=American%20Football");
    const data = await r.json();

    // fallback: upcoming games if no live data
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
    const { amount } = req.body; // amount in cents from frontend

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
      success_url: "https://pi2sports.netlify.app?success=true",
      cancel_url: "https://pi2sports.netlify.app?cancelled=true",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
