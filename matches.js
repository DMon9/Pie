
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../jwt');
const { settleMatch } = require('../services/settlement');
const router = express.Router();

// list upcoming/live
router.get('/', async (_req, res) => {
  const rows = await db('matches').select('*').orderBy('start_time','asc').limit(200);
  res.json(rows);
});

// admin create
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  const { home_team, away_team, start_time } = req.body;
  const [idObj] = await db('matches').insert({ home_team, away_team, start_time, status: 'scheduled' }).returning('id');
  const id = typeof idObj === 'object' ? idObj.id : idObj;
  const m = await db('matches').where({ id }).first();
  res.json(m);
});

// admin update score / status
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  await db('matches').where({ id }).update(req.body);
  const m = await db('matches').where({ id }).first();
  res.json(m);
});

// admin finalize and autograde
router.post('/:id/finish', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { home_score, away_score } = req.body;
  await db('matches').where({ id }).update({ status: 'finished', home_score, away_score });
  const result = await settleMatch(id);
  res.json({ ok: true, ...result });
});

module.exports = router;
