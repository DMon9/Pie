# Pi² Sports Backend — Auth + Stripe + Contests + Odds

## Env (Render → Settings → Environment)
- DATABASE_URL=postgres://user:pass@host:5432/db
- STRIPE_SECRET_KEY=sk_live_... (or sk_test_...)
- STRIPE_WEBHOOK_SECRET=whsec_...
- FRONTEND_URL=https://pi2sports.netlify.app
- JWT_SECRET=<random-long-string>
- ADMIN_EMAIL=<your admin email>
- PLATFORM_RAKE_PCT=0.07
- ODDS_API_KEY=<your odds api key>

## Routes
- POST /register, POST /login
- GET /me/balance (auth)
- POST /api/create-checkout-session (auth) → {amount:cents}
- POST /webhook (Stripe)
- GET /contests
- POST /contests/:id/enter (auth)
- ADMIN (auth as ADMIN_EMAIL):
  - POST /admin/contests
  - PATCH /admin/contests/:id
  - DELETE /admin/contests/:id
  - POST /admin/contests/:id/settle { winners:[emails] }
- GET /games/college-football (Odds API)
