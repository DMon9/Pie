
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../jwt');
const router = express.Router();

// upsert odds for a match
router.post('/:matchId', requireAuth, requireAdmin, async (req, res) => {
  const { matchId } = req.params;
  const { market='moneyline', odds_home, odds_away } = req.body;
  const existing = await db('odds').where({ match_id: matchId, market }).first();
  if (existing) {
    await db('odds').where({ id: existing.id }).update({ odds_home, odds_away, updated_at: db.fn.now() });
    return res.json(await db('odds').where({ id: existing.id }).first());
  } else {
    const [idObj] = await db('odds').insert({ match_id: matchId, market, odds_home, odds_away }).returning('id');
    const id = typeof idObj === 'object' ? idObj.id : idObj;
    return res.json(await db('odds').where({ id }).first());
  }
});

// get odds for a match
router.get('/:matchId', async (req, res) => {
  const rows = await db('odds').where({ match_id: req.params.matchId }).orderBy('updated_at','desc');
  res.json(rows);
});

module.exports = router;
