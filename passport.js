
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('./db');

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (_a, _r, profile, done) => {
  try {
    const email = (profile.emails && profile.emails[0]?.value || '').toLowerCase();
    const name = profile.displayName || 'Google User';
    const picture = (profile.photos && profile.photos[0]?.value) || '';
    const google_id = profile.id;

    let user = await db('users').where({ google_id }).first();
    if (!user) {
      const byEmail = email ? await db('users').where({ email }).first() : null;
      if (byEmail) { await db('users').where({ id: byEmail.id }).update({ google_id, name, picture }); user = await db('users').where({ id: byEmail.id }).first(); }
      else {
        const role = (email && email === (process.env.ADMIN_EMAIL || '').toLowerCase()) ? 'admin' : 'user';
        const [idObj] = await db('users').insert({ google_id, email, name, picture, role }).returning('id');
        const id = typeof idObj === 'object' ? idObj.id : idObj;
        user = await db('users').where({ id }).first();
      }
    }
    return done(null, user);
  } catch (e) {
    console.error('Google auth error', e);
    return done(e, null);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { const u = await db('users').where({ id }).first(); done(null, u || null); } catch (e) { done(e, null); }
});

module.exports = passport;
