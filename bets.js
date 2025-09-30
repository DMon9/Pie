
const express = require('express');
const db = require('../db');
const { requireAuth } = require('../jwt');
const router = express.Router();

// place a bet (moneyline: select 'home' or 'away')
router.post('/', requireAuth, async (req, res) => {
  const { match_id, selection, wager } = req.body;
  if (!['home','away'].includes(selection)) return res.status(400).json({ error: 'selection must be home|away' });
  const match = await db('matches').where({ id: match_id }).first();
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (match.status === 'finished') return res.status(400).json({ error: 'Match already finished' });

  const user = await db('users').where({ id: req.user.id }).first();
  if ((user.balance||0) < wager) return res.status(400).json({ error: 'Insufficient balance' });

  // get latest odds (moneyline)
  const latestOdds = await db('odds').where({ match_id }).orderBy('updated_at','desc').first();
  const odds_at_bet = selection === 'home' ? (latestOdds?.odds_home ?? -110) : (latestOdds?.odds_away ?? -110);

  await db.transaction(async trx => {
    await trx('users').where({ id: user.id }).update({ balance: (user.balance||0) - wager });
    const [idObj] = await trx('bets').insert({
      user_id: user.id, match_id, wager, selection, odds_at_bet, status: 'pending'
    }).returning('id');
    const id = typeof idObj === 'object' ? idObj.id : idObj;
    await trx('transactions').insert({ user_id: user.id, type: 'bet', amount: -Math.round(wager) });
    const bet = await trx('bets').where({ id }).first();
    res.json({ ok: true, bet });
  });
});

// list my bets
router.get('/mine', requireAuth, async (req, res) => {
  const rows = await db('bets').where({ user_id: req.user.id }).orderBy('created_at','desc');
  res.json(rows);
});

module.exports = router;
