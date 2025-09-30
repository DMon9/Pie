export async function up(knex) {
  await knex.schema.createTable('users', (table) => {
    table.increments('id').primary();
    table.string('google_id').unique();
    table.string('email').unique();
    table.string('name');
    table.string('picture');
    table.integer('balance').defaultTo(0);
    table.timestamps(true, true);
  });

  await knex.schema.createTable('contests', (table) => {
    table.increments('id').primary();
    table.string('title').notNullable();
    table.string('sport').notNullable();
    table.integer('entry_fee').notNullable();
    table.integer('prize_pool').notNullable();
    table.timestamps(true, true);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('contests');
  await knex.schema.dropTableIfExists('users');
}
