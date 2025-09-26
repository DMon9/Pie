# Pi2Sports Backend (Live Mode)

Backend API for Pi2Sports built with Node.js, Express, and Stripe.

## Deploy on Render
1. Upload this repo to GitHub and connect it to Render.
2. Set Environment Variables in Render:
   - STRIPE_SECRET_KEY = sk_live_xxxxx
   - STRIPE_WEBHOOK_SECRET = whsec_xxxxx
   - FRONTEND_URL = https://pi2sports.netlify.app
3. Deploy → Service will be available at https://pi-fsqg.onrender.com

## Routes
- GET `/` → Health check
- POST `/api/create-checkout-session` → Create Stripe Checkout for deposits
- POST `/webhook` → Stripe webhook handler
- POST `/api/withdraw-request` → Log a withdrawal request (deduct balance)
- GET `/api/withdraw-requests` → List withdrawal requests
