
const express = require('express');
const passport = require('../passport');
const { signToken } = require('../jwt');
const router = express.Router();

router.get('/google', passport.authenticate('google', { scope: ['profile','email'], session: false }));
router.get('/google/callback', passport.authenticate('google', { session: false, failureRedirect: '/' }), (req, res) => {
  const token = signToken(req.user);
  const redirect = `${process.env.FRONTEND_URL}/auth/success#token=${token}`;
  res.redirect(redirect);
});
module.exports = router;
