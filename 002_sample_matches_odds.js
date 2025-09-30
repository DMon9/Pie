
exports.seed = async function(knex) {
  await knex('matches').del();
  await knex('odds').del();

  const now = new Date();
  const addHours = (h) => new Date(now.getTime() + h*3600*1000).toISOString();

  const [m1] = await knex('matches').insert({
    home_team: 'KC Chiefs',
    away_team: 'LV Raiders',
    start_time: addHours(24),
    status: 'scheduled'
  }).returning('id');

  const [m2] = await knex('matches').insert({
    home_team: 'DAL Cowboys',
    away_team: 'PHI Eagles',
    start_time: addHours(48),
    status: 'scheduled'
  }).returning('id');

  const id1 = typeof m1 === 'object' ? m1.id : m1;
  const id2 = typeof m2 === 'object' ? m2.id : m2;

  await knex('odds').insert([
    { match_id: id1, market: 'moneyline', odds_home: -135, odds_away: +115 },
    { match_id: id2, market: 'moneyline', odds_home: -110, odds_away: -110 }
  ]);
};
