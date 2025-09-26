# Pi2Sports Backend (Auth + Stripe + Postgres)

## Env Vars (Render → Settings → Environment)
- DATABASE_URL: postgres://user:pass@host:5432/db (Render Postgres; SSL on)
- STRIPE_SECRET_KEY: sk_live_... (or sk_test_...)
- STRIPE_WEBHOOK_SECRET: whsec_...
- FRONTEND_URL: https://pi2sports.netlify.app
- JWT_SECRET: a-long-random-string

## Endpoints
- POST /register {email,password}
- POST /login {email,password} → {token}
- GET /me/balance  (Authorization: Bearer <token>)
- POST /api/create-checkout-session {amount}  (integer cents) (auth)
- POST /me/withdraw-request {amount} (auth)
- POST /webhook  (Stripe)

## Notes
- Tables auto-create on boot.
- Webhook credits user's balance after successful deposit.
