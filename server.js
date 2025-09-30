import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import passport from 'passport';
import session from 'express-session';
import authRoutes from './routes/auth.js';
import paymentRoutes from './routes/payments.js';
import './services/passportGoogle.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'pi2secret',
  resave: false,
  saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.session());

app.get('/', (req, res) => {
  res.send('Pi2 Backend API Running');
});

app.use('/auth', authRoutes);
app.use('/payments', paymentRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
