#!/usr/bin/env node
/**
 * Unit tests for the tiebreaker chain and bracket resolution.
 *
 * This decides who plays in the final, so it gets tested rather than eyeballed.
 * Run: node scripts/test-standings.mjs
 */

import { computeStandings, unresolvedTies, poolComplete } from '../js/standings.js';
import { computeBracket, winnerOf, finalPlacings } from '../js/bracket.js';

let pass = 0;
const failures = [];

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else failures.push(`${label}\n      expected ${e}\n      got      ${a}`);
}

const mkTeams = (...ids) => ids.map((id) => ({ id, name: id }));

let gameSeq = 0;
/** A final pool game. */
const g = (teamA, scoreA, teamB, scoreB) => ({
  id: `g${++gameSeq}`,
  phase: 'pool',
  slot: 1,
  court: 1,
  teamA,
  teamB,
  scoreA,
  scoreB,
  status: 'final',
});
/** An unplayed pool game. */
const pending = (teamA, teamB) => ({
  id: `g${++gameSeq}`,
  phase: 'pool',
  slot: 1,
  court: 1,
  teamA,
  teamB,
  scoreA: null,
  scoreB: null,
  status: 'scheduled',
});

const order = (s) => s.map((r) => r.id);

// --- 1. Ordering by wins -----------------------------------------------------
{
  const teams = mkTeams('a', 'b', 'c');
  const games = [g('a', 21, 'b', 10), g('a', 21, 'c', 12), g('b', 21, 'c', 15)];
  const s = computeStandings(teams, games);
  check('1. ranks by wins', order(s), ['a', 'b', 'c']);
  check('1. record of a', [s[0].wins, s[0].losses, s[0].diff], [2, 0, 20]);
}

// --- 2. Two-way tie broken by head-to-head -----------------------------------
{
  // Full round robin. a and b both finish 2-1, but b beat a head-to-head.
  // a's differential is +27 to b's +2 — head-to-head still wins, because it
  // is the earlier tiebreaker. This is the case that matters most: blowing
  // out weak teams must not outrank beating the team you're tied with.
  const teams = mkTeams('a', 'b', 'c', 'd');
  const games = [
    g('b', 21, 'a', 19),
    g('a', 21, 'c', 5),
    g('a', 21, 'd', 8),
    g('b', 21, 'c', 19),
    g('d', 21, 'b', 19),
    g('c', 21, 'd', 15),
  ];
  const s = computeStandings(teams, games);
  check('2. both tied on wins', [s[0].wins, s[1].wins], [2, 2]);
  check('2. a has the better differential', [
    s.find((r) => r.id === 'a').diff,
    s.find((r) => r.id === 'b').diff,
  ], [27, 2]);
  check('2. head-to-head still beats differential', order(s).slice(0, 2), ['b', 'a']);
  check('2. no unresolved ties', unresolvedTies(s), []);
}

// --- 3. Tie between teams who never met -> point differential ----------------
{
  // a and b never play each other (realistic: 3 pairings are omitted).
  const teams = mkTeams('a', 'b', 'c', 'd');
  const games = [
    g('a', 21, 'c', 5), // a +16
    g('a', 10, 'd', 21),
    g('b', 21, 'c', 15), // b +6
    g('b', 10, 'd', 21),
  ];
  const s = computeStandings(teams, games);
  const ab = order(s).filter((x) => x === 'a' || x === 'b');
  check('3. differential separates teams who never met', ab, ['a', 'b']);
}

// --- 4. Three-way tie resolved by mini-league --------------------------------
{
  // a, b, c all 2-1 overall. Among themselves: a 2-0, b 1-1, c 0-2.
  const teams = mkTeams('a', 'b', 'c', 'd');
  const games = [
    g('a', 21, 'b', 19),
    g('a', 21, 'c', 19),
    g('b', 21, 'c', 19),
    g('d', 21, 'a', 10),
    g('d', 21, 'b', 10),
    g('d', 21, 'c', 10),
  ];
  const s = computeStandings(teams, games);
  check('4. three-way tie uses mini-league', order(s), ['d', 'a', 'b', 'c']);
}

// --- 5. Genuine dead heat is flagged, not silently ordered -------------------
// a and b never play each other, finish on identical wins, identical
// differential and identical points scored. Nothing computable separates them.
// Every other pair is deliberately separated so exactly one tie is open.
const deadHeat = () => {
  gameSeq = 0;
  return {
    teams: mkTeams('a', 'b', 'c', 'd', 'e', 'f'),
    games: [
      g('a', 21, 'c', 10), // a: 1-1, pf 32, pa 31, diff +1
      g('d', 21, 'a', 11),
      g('b', 21, 'e', 10), // b: 1-1, pf 32, pa 31, diff +1  <- identical to a
      g('f', 21, 'b', 11),
      g('d', 21, 'c', 4),  // d +27 vs f +23, so d and f are separated
      g('f', 21, 'e', 8),  // c -28 vs e -24, so c and e are separated
    ],
  };
};

{
  const { teams, games } = deadHeat();
  const s = computeStandings(teams, games);
  const ties = unresolvedTies(s);

  check('5. exactly one dead heat', ties.length, 1);
  check('5. dead heat names both teams', ties[0]?.ids, ['a', 'b']);
  check('5. a and b really are identical', [
    s.find((r) => r.id === 'a').diff, s.find((r) => r.id === 'a').pointsFor,
    s.find((r) => r.id === 'b').diff, s.find((r) => r.id === 'b').pointsFor,
  ], [1, 32, 1, 32]);
  check('5. everyone else is separated', order(s).filter((x) => x !== 'a' && x !== 'b'), ['d', 'f', 'e', 'c']);

  const b = computeBracket(teams, games);
  check('5. bracket is NOT seedable while tied', b.seedable, false);
  check('5. seeds are empty while tied', b.seeds, []);
}

// --- 6. A manual decision resolves the dead heat -----------------------------
{
  const { teams, games } = deadHeat();
  const manual = { 'a|b': ['b', 'a'] }; // Neal's rock-paper-scissors result
  const s = computeStandings(teams, games, manual);

  check('6. manual pick clears the tie', unresolvedTies(s), []);
  check('6. manual pick sets the order', order(s).filter((x) => x === 'a' || x === 'b'), ['b', 'a']);

  const b = computeBracket(teams, games, { manualTiebreaks: manual });
  check('6. bracket becomes seedable', b.seedable, true);
  check('6. seeds reflect the manual pick', b.seeds, ['d', 'f', 'b', 'a', 'e', 'c']);
}

// --- 7. poolComplete ---------------------------------------------------------
{
  const teams = mkTeams('a', 'b');
  check('7. incomplete pool', poolComplete([g('a', 21, 'b', 1), pending('a', 'b')]), false);
  check('7. complete pool', poolComplete([g('a', 21, 'b', 1)]), true);
  check('7. empty pool is not complete', poolComplete([]), false);
}

// --- 8. Bracket resolution end to end ----------------------------------------
{
  const teams = mkTeams('a', 'b', 'c', 'd');
  const pool = [
    g('a', 21, 'b', 10),
    g('a', 21, 'c', 10),
    g('a', 21, 'd', 10), // a 3-0
    g('b', 21, 'c', 10),
    g('b', 21, 'd', 10), // b 2-1
    g('c', 21, 'd', 10), // c 1-2, d 0-3
  ];
  const bracketGames = [
    { id: 'sf1', phase: 'bracket', slot: 7, court: 1, label: 'Semifinal 1', aSeed: 1, bSeed: 4, status: 'scheduled', scoreA: null, scoreB: null },
    { id: 'sf2', phase: 'bracket', slot: 7, court: 2, label: 'Semifinal 2', aSeed: 2, bSeed: 3, status: 'scheduled', scoreA: null, scoreB: null },
    { id: 'final', phase: 'bracket', slot: 8, court: 1, label: 'Final', aWinnerOf: 'sf1', bWinnerOf: 'sf2', status: 'scheduled', scoreA: null, scoreB: null },
    { id: 'third', phase: 'bracket', slot: 8, court: 2, label: '3rd Place', aLoserOf: 'sf1', bLoserOf: 'sf2', status: 'scheduled', scoreA: null, scoreB: null },
  ];

  const b1 = computeBracket(teams, [...pool, ...bracketGames]);
  check('8. seedable once pool is complete', b1.seedable, true);
  check('8. seed order', b1.seeds, ['a', 'b', 'c', 'd']);
  const sf1 = b1.games.find((x) => x.id === 'sf1');
  const sf2 = b1.games.find((x) => x.id === 'sf2');
  check('8. SF1 is #1 v #4', [sf1.sideA.teamId, sf1.sideB.teamId], ['a', 'd']);
  check('8. SF2 is #2 v #3', [sf2.sideA.teamId, sf2.sideB.teamId], ['b', 'c']);

  const fin = b1.games.find((x) => x.id === 'final');
  check('8. final unresolved before semis', [fin.sideA.teamId, fin.sideB.teamId], [null, null]);
  check('8. final shows its source', fin.sideA.source, 'Winner of Semifinal 1');
  check('8. final not ready', fin.ready, false);

  // Play the semis: a beats d, c upsets b.
  const played = bracketGames.map((x) =>
    x.id === 'sf1' ? { ...x, teamA: 'a', teamB: 'd', scoreA: 25, scoreB: 12, status: 'final' } :
    x.id === 'sf2' ? { ...x, teamA: 'b', teamB: 'c', scoreA: 20, scoreB: 25, status: 'final' } : x
  );
  const b2 = computeBracket(teams, [...pool, ...played]);
  const fin2 = b2.games.find((x) => x.id === 'final');
  const third2 = b2.games.find((x) => x.id === 'third');
  check('8. final resolves to SF winners', [fin2.sideA.teamId, fin2.sideB.teamId], ['a', 'c']);
  check('8. 3rd place resolves to SF losers', [third2.sideA.teamId, third2.sideB.teamId], ['d', 'b']);
  check('8. final is ready to play', fin2.ready, true);
}

// --- 9. Locking freezes seeds against a late pool correction -----------------
{
  const teams = mkTeams('a', 'b', 'c', 'd');
  const pool = [
    g('a', 21, 'b', 10), g('a', 21, 'c', 10), g('a', 21, 'd', 10),
    g('b', 21, 'c', 10), g('b', 21, 'd', 10), g('c', 21, 'd', 10),
  ];
  const sf = [{ id: 'sf1', phase: 'bracket', slot: 7, court: 1, aSeed: 1, bSeed: 4, status: 'scheduled', scoreA: null, scoreB: null }];

  const locked = ['a', 'b', 'c', 'd'];
  // Someone corrects a pool score badly enough to flip the standings.
  const corrected = pool.map((x) => (x.teamA === 'a' && x.teamB === 'b' ? { ...x, scoreA: 10, scoreB: 21 } : x));

  const unlockedB = computeBracket(teams, [...corrected, ...sf]);
  const lockedB = computeBracket(teams, [...corrected, ...sf], { lockedSeeds: locked });

  check('9. unlocked bracket reshuffles after a correction', unlockedB.seeds[0], 'b');
  check('9. locked bracket holds its seeding', lockedB.seeds, locked);
  check('9. locked flag set', lockedB.locked, true);
}

// --- 10. Placings ------------------------------------------------------------
{
  const teams = mkTeams('a', 'b', 'c', 'd', 'e', 'f');
  const bracket = {
    seeds: ['a', 'b', 'c', 'd', 'e', 'f'],
    games: [
      { id: 'final', status: 'final', teamA: 'a', teamB: 'c', scoreA: 25, scoreB: 20 },
      { id: 'third', status: 'final', teamA: 'd', teamB: 'b', scoreA: 18, scoreB: 25 },
    ],
  };
  check('10. placings', finalPlacings(bracket), [
    { place: 1, teamId: 'a' },
    { place: 2, teamId: 'c' },
    { place: 3, teamId: 'b' },
    { place: 4, teamId: 'd' },
    { place: 5, teamId: 'e' },
    { place: 6, teamId: 'f' },
  ]);
}

// --- 10b. Placings with a seven-team field -----------------------------------
// The bracket is still four teams, so seeds 5, 6 and 7 all place on pool record.
{
  const teams = mkTeams('a', 'b', 'c', 'd', 'e', 'f', 'g');
  const bracket = {
    seeds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    games: [
      { id: 'final', status: 'final', teamA: 'a', teamB: 'c', scoreA: 25, scoreB: 20 },
      { id: 'third', status: 'final', teamA: 'd', teamB: 'b', scoreA: 18, scoreB: 25 },
    ],
  };
  check('10b. seven-team placings run to 7th', finalPlacings(bracket), [
    { place: 1, teamId: 'a' },
    { place: 2, teamId: 'c' },
    { place: 3, teamId: 'b' },
    { place: 4, teamId: 'd' },
    { place: 5, teamId: 'e' },
    { place: 6, teamId: 'f' },
    { place: 7, teamId: 'g' },
  ]);
}

// --- 11. winnerOf guards -----------------------------------------------------
{
  check('11. no winner while scheduled', winnerOf({ status: 'scheduled', teamA: 'a', teamB: 'b' }), null);
  check('11. no winner for missing game', winnerOf(undefined), null);
}

// --- Report ------------------------------------------------------------------
const total = pass + failures.length;
console.log(`\n  ${pass}/${total} assertions passed`);
if (failures.length) {
  console.error('\n  FAILED:\n');
  for (const f of failures) console.error(`   ✗ ${f}\n`);
  process.exit(1);
}
console.log('  ✓ Standings and bracket logic correct\n');
