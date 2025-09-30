export async function seed(knex) {
  await knex('contests').del();

  await knex('contests').insert([
    { title: 'NFL Sunday Contest', sport: 'NFL', entry_fee: 500, prize_pool: 5000 },
    { title: 'CFB Saturday Contest', sport: 'CFB', entry_fee: 300, prize_pool: 3000 }
  ]);
}
