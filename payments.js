
const express = require('express');
const Stripe = require('stripe');
const { requireAuth } = require('../jwt');
const db = require('../db');
const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const amount = Math.max(1, Number(req.body.amount || 0)) * 100;
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: { currency: 'usd', product_data: { name: 'Pi2 Deposit' }, unit_amount: amount },
        quantity: 1
      }],
      metadata: { userId: String(req.user.id), email: req.user.email },
      customer_email: req.user.email,
      success_url: `${process.env.FRONTEND_URL}/?deposit=success`,
      cancel_url: `${process.env.FRONTEND_URL}/?deposit=cancelled`
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe create session error', err);
    res.status(500).json({ error: 'stripe_failed' });
  }
});

// webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event; const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Stripe webhook verify failed', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object;
    const email = s.customer_details?.email || s.metadata?.email;
    const amount = s.amount_total || 0;
    if (email && amount > 0) {
      const user = await db('users').where({ email: email.toLowerCase() }).first();
      if (user) {
        await db.transaction(async trx => {
          await trx('users').where({ id: user.id }).update({ balance: (user.balance||0) + Math.round(amount/100) });
          await trx('transactions').insert({ user_id: user.id, type: 'deposit', amount: Math.round(amount/100) });
        });
      }
    }
  }
  res.json({ received: true });
});

module.exports = router;
