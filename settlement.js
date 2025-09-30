
const db = require('../db');

function money(n){ return Math.round(n); } // expecting integer dollars

async function settleMatch(matchId){
  const match = await db('matches').where({ id: matchId }).first();
  if(!match || match.status !== 'finished') throw new Error('Match not finished');

  const bets = await db('bets').where({ match_id: matchId, status: 'pending' });
  const homeWon = match.home_score > match.away_score;
  const winner = homeWon ? 'home' : 'away';

  for(const bet of bets){
    let status = 'lost';
    let payout = 0;
    if(bet.selection === winner){
      // American odds payout
      const odds = bet.odds_at_bet;
      const stake = bet.wager;
      if (odds > 0) payout = stake + Math.floor(stake * (odds/100));
      else payout = stake + Math.floor(stake * (100/Math.abs(odds)));
      status = 'won';
    }
    await db.transaction(async trx => {
      await trx('bets').where({ id: bet.id }).update({ status });
      if(payout > 0){
        const user = await trx('users').where({ id: bet.user_id }).first();
        await trx('users').where({ id: bet.user_id }).update({ balance: (user.balance||0) + money(payout) });
        await trx('transactions').insert({ user_id: bet.user_id, type: 'payout', amount: money(payout) });
      }
    });
  }
  return { settled: bets.length };
}

module.exports = { settleMatch };
