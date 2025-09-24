const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY); // add your secret key in Render env

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Test route
app.get("/", (req, res) => {
  res.send("✅ Pi Squared Backend is running");
});

// Stripe checkout session route
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { wallet, amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Deposit for wallet: ${wallet || "guest"}`,
            },
            unit_amount: amount * 100, // cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: process.env.FRONTEND_URL + "#/deposit-success",
      cancel_url: process.env.FRONTEND_URL + "#/deposit-cancel",
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err.message);
    res.status(500).json({ error: "Payment session failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
