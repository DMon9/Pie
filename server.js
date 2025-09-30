
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const passport = require('./passport');
const { signToken } = require('./jwt');

const auth = require('./routes/auth');
const payments = require('./routes/payments');
const matches = require('./routes/matches');
const odds = require('./routes/odds');
const bets = require('./routes/bets');

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// CORS
app.use(cors({ origin: [FRONTEND_URL], credentials: true }));

// Stripe webhook route must be raw; it's inside /payments as /webhook, so mount it before json parser:
app.use('/payments', require('./routes/payments'));

// Parsers
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Minimal session for Google OAuth handshake
app.use(session({
  name: 'pi2.sid',
  secret: process.env.JWT_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Health
app.get('/api/ping', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Auth
app.use('/auth', auth);

// API
app.use('/matches', matches);
app.use('/odds', odds);
app.use('/bets', bets);

// Me
app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ authenticated: false });
  const token = signToken(req.user);
  res.json({ authenticated: true, user: req.user, token });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pi2 backend (auto-grade) listening on :${PORT}`));
