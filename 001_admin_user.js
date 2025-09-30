
exports.seed = async function(knex) {
  const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  await knex('users').del();
  await knex('users').insert([
    { google_id: 'admin-google-id', email, name: 'Pi2 Admin', picture: '', role: 'admin', balance: 1000 }
  ]);
};
