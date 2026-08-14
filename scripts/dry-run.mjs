#!/usr/bin/env node
/**
 * End-to-end dry run against the real Supabase project.
 *
 * Plays a full tournament through the same edge function the captains will
 * use, checks that standings, tiebreakers, seeding and the bracket all come
 * out right, then clears every score.
 *
 *   node scripts/dry-run.mjs          play, verify, reset
 *   node scripts/dry-run.mjs --keep   leave the scores in
 *   node scripts/dry-run.mjs --reset  clear scores only
 */

import { computeStandings, unresolvedTies } from '../js/standings.js';
import { computeBracket, finalPlacings } from '../js/bracket.js';

const URL = 'https://yxmkothzqvyptftedlen.supabase.co';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4bWtvdGh6cXZ5cHRmdGVkbGVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTYzMTIsImV4cCI6MjEwMjIzMjMxMn0.t-N0uqb0dWKKJCWtPZKmZ76SzYw1rt2gUIGYxgUTJeI';

const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const RESET_ONLY = args.includes('--reset');

const headers = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

const call = async (payload) => {
  const res = await fetch(`${URL}/functions/v1/submit-score`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${payload.action} ${payload.gameId ?? ''}: ${body.error ?? res.status}`);
  return body;
};

const load = async () => {
  const get = async (path) => {
    const res = await fetch(`${URL}/rest/v1/${path}`, { headers });
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  };
  const [teams, games, state] = await Promise.all([
    get('teams?select=*&order=seed'),
    get('games?select=*&order=slot,court'),
    get('tournament_state?select=*&id=eq.1'),
  ]);
  return {
    teams: teams.map((t) => ({ ...t, colorA: t.color_a, colorB: t.color_b })),
    games: games.map((g) => ({
      id: g.id, slot: g.slot, phase: g.phase, court: g.court, label: g.label,
      teamA: g.team_a, teamB: g.team_b, refTeam: g.ref_team,
      aSeed: g.a_seed, bSeed: g.b_seed,
      aWinnerOf: g.a_winner_of, bWinnerOf: g.b_winner_of,
      aLoserOf: g.a_loser_of, bLoserOf: g.b_loser_of,
      scoreA: g.score_a, scoreB: g.score_b, status: g.status,
    })),
    state: state[0] ?? {},
  };
};

let pass = 0;
const failures = [];
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass += 1; console.log(`   ✓ ${label}`); }
  else { failures.push(`${label}\n       expected ${e}\n       got      ${a}`); console.log(`   ✗ ${label}`); }
};

async function resetAll() {
  const { games } = await load();
  const played = games.filter((g) => g.status === 'final');
  for (const g of played) await call({ action: 'reopen', gameId: g.id });
  await call({ action: 'state', bracketLocked: false, lockedSeeds: null, manualTiebreaks: {} });
  return played.length;
}

if (RESET_ONLY) {
  const n = await resetAll();
  console.log(`\n  Cleared ${n} scores and unlocked the bracket.\n`);
  process.exit(0);
}

// --- Pool results -------------------------------------------------------------
// Chosen to produce a clean ranking with one genuine head-to-head tiebreak:
// Cinnamon Rolls and Haikyuties both finish 2-2, and Cinnamon won the meeting.
const POOL = [
  ['p1', 21, 12], ['p2', 21, 18], ['p3', 15, 21], ['p4', 17, 21],
  ['p5', 21, 19], ['p6', 21, 14], ['p7', 11, 21], ['p8', 21, 19],
  ['p9', 21, 16], ['p10', 21, 13], ['p11', 21, 17], ['p12', 12, 21],
];

console.log('\n  Dry run — playing a full tournament through the live API\n');

console.log('  Clearing any previous state…');
await resetAll();

console.log('\n  Pool play');
for (const [gameId, scoreA, scoreB] of POOL) {
  await call({ action: 'score', gameId, scoreA, scoreB });
}
console.log(`   ✓ submitted ${POOL.length} pool scores`);

let { teams, games, state } = await load();
const name = (id) => teams.find((t) => t.id === id)?.name ?? id;

console.log('\n  Standings');
const standings = computeStandings(teams, games, state.manual_tiebreaks ?? {});
for (const r of standings) {
  console.log(
    `   ${String(r.rank).padStart(2)}. ${r.team.name.padEnd(21)} ` +
      `${r.wins}-${r.losses}  ${r.diff > 0 ? '+' : ''}${r.diff}`
  );
}

check('records are right', standings.map((r) => `${r.id} ${r.wins}-${r.losses}`), [
  'deez-nets 4-0',
  'tequila-mockingbird 3-1',
  'cinnamon-rolls 2-2',
  'haikyuties 2-2',
  'perros-calientes 1-3',
  'bumping-buds 0-4',
]);
check('no unresolved ties', unresolvedTies(standings), []);

// Cinnamon and Haikyuties are both 2-2. Cinnamon won the head-to-head (p9),
// so it must rank higher — even though this is the earlier tiebreaker than
// point differential.
const cin = standings.find((r) => r.id === 'cinnamon-rolls');
const hai = standings.find((r) => r.id === 'haikyuties');
check('2-2 tie broken by head-to-head, not differential', cin.rank < hai.rank, true);

let bracket = computeBracket(teams, games, { manualTiebreaks: state.manual_tiebreaks ?? {} });
check('bracket is seedable', bracket.seedable, true);
check('seed order', bracket.seeds, [
  'deez-nets', 'tequila-mockingbird', 'cinnamon-rolls', 'haikyuties', 'perros-calientes', 'bumping-buds',
]);

console.log('\n  Locking the bracket');
await call({ action: 'state', bracketLocked: true, lockedSeeds: bracket.seeds });
({ teams, games, state } = await load());
check('bracket locked', state.bracket_locked, true);
check('locked seeds stored', state.locked_seeds, bracket.seeds);

// A late correction must NOT move the semifinals now.
console.log('\n  Correcting a pool score after locking (must not reshuffle)');
await call({ action: 'score', gameId: 'p1', scoreA: 5, scoreB: 21 }); // Deez now lose
({ teams, games, state } = await load());
bracket = computeBracket(teams, games, {
  manualTiebreaks: state.manual_tiebreaks ?? {},
  lockedSeeds: state.bracket_locked ? state.locked_seeds : null,
});
check('locked seeding survives a pool correction', bracket.seeds[0], 'deez-nets');
await call({ action: 'score', gameId: 'p1', scoreA: 21, scoreB: 12 }); // put it back

console.log('\n  Semifinals');
({ teams, games, state } = await load());
bracket = computeBracket(teams, games, {
  manualTiebreaks: state.manual_tiebreaks ?? {},
  lockedSeeds: state.locked_seeds,
});
const sf1 = bracket.games.find((g) => g.id === 'sf1');
const sf2 = bracket.games.find((g) => g.id === 'sf2');
check('SF1 is #1 v #4', [sf1.sideA.teamId, sf1.sideB.teamId], ['deez-nets', 'haikyuties']);
check('SF2 is #2 v #3', [sf2.sideA.teamId, sf2.sideB.teamId], ['tequila-mockingbird', 'cinnamon-rolls']);

await call({ action: 'score', gameId: 'sf1', scoreA: 25, scoreB: 18 }); // Deez through
await call({ action: 'score', gameId: 'sf2', scoreA: 22, scoreB: 25 }); // Cinnamon upset

({ teams, games, state } = await load());
bracket = computeBracket(teams, games, {
  manualTiebreaks: state.manual_tiebreaks ?? {},
  lockedSeeds: state.locked_seeds,
});
const fin = bracket.games.find((g) => g.id === 'final');
const third = bracket.games.find((g) => g.id === 'third');
check('final resolved to SF winners', [fin.sideA.teamId, fin.sideB.teamId], ['deez-nets', 'cinnamon-rolls']);
check('3rd place resolved to SF losers', [third.sideA.teamId, third.sideB.teamId], ['haikyuties', 'tequila-mockingbird']);

console.log('\n  Final and 3rd place');
await call({ action: 'score', gameId: 'final', scoreA: 25, scoreB: 21 });
await call({ action: 'score', gameId: 'third', scoreA: 19, scoreB: 25 });

({ teams, games, state } = await load());
bracket = computeBracket(teams, games, {
  manualTiebreaks: state.manual_tiebreaks ?? {},
  lockedSeeds: state.locked_seeds,
});
const places = finalPlacings(bracket);
console.log('');
for (const p of places) console.log(`   ${p.place}. ${name(p.teamId)}`);

check('final placings', places, [
  { place: 1, teamId: 'deez-nets' },
  { place: 2, teamId: 'cinnamon-rolls' },
  { place: 3, teamId: 'tequila-mockingbird' },
  { place: 4, teamId: 'haikyuties' },
  { place: 5, teamId: 'perros-calientes' },
  { place: 6, teamId: 'bumping-buds' },
]);
check('every game is final', games.every((g) => g.status === 'final'), true);

// --- Reset ---------------------------------------------------------------------
if (!KEEP) {
  console.log('\n  Resetting…');
  const n = await resetAll();
  const after = await load();
  check('all scores cleared', after.games.every((g) => g.status === 'scheduled' && g.scoreA === null), true);
  check('bracket unlocked', after.state.bracket_locked, false);

  // Regression: reopening a bracket game used to leave team_a/team_b populated,
  // so the semifinals showed real teams before a single pool game was played.
  const bracketAfter = after.games.filter((g) => g.phase === 'bracket');
  check(
    'bracket games have no teams after reset',
    bracketAfter.every((g) => g.teamA === null && g.teamB === null),
    true
  );
  const freshBracket = computeBracket(after.teams, after.games, {});
  check('no bracket game looks playable after reset', freshBracket.games.every((g) => !g.ready), true);
  console.log(`   cleared ${n} games`);
} else {
  console.log('\n  --keep: leaving the dry-run scores in place.');
}

const total = pass + failures.length;
console.log(`\n  ${pass}/${total} checks passed`);
if (failures.length) {
  console.error('\n  FAILED:\n');
  for (const f of failures) console.error(`   ✗ ${f}\n`);
  process.exit(1);
}
console.log('  ✓ Full tournament runs correctly end to end\n');
