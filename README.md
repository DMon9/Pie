
# Pi² Sports Backend (Full Scaffold)
- Email/password + Google OAuth (redirects back to FRONTEND_URL with JWT).
- Stripe webhook validates referrals on any $10+ deposit.
- Referrals API (validated, pending) + global leaderboard.
- Milestones: 100=$20, 500=$100, 1000=$1000 (first only) — **admin approval required**.
- Image proxy endpoints (ESPN fallback) for team logos & player headshots.
- **In-memory store** for easy testing — replace with a real DB when ready.

## ENV (Render)
```
FRONTEND_URL=https://pi2sports.netlify.app
JWT_SECRET=change-me
ADMIN_TOKEN=change-me-admin

STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...

GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://<your-render-service>/auth/google/callback

IMAGE_PROVIDER_PRIMARY=sportradar
IMAGE_PROVIDER_FALLBACK=espn
IMAGE_PLACEHOLDER_TEAM=/assets/default-team.svg
IMAGE_PLACEHOLDER_PLAYER=/assets/default-player.svg
PORT=3000
```

## Start
```
npm install
npm start
```
