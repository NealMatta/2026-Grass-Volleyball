#!/usr/bin/env node
/**
 * Asserts the pool schedule invariants against data/schedule.json.
 *
 * This exists because the hand-written version of the schedule table was wrong
 * once already (a team ended up with 3 pool games instead of 4). Never trust a
 * hand-built round robin — check it.
 *
 * Run: node scripts/verify-schedule.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const { teams } = read('data/teams.json');
const schedule = read('data/schedule.json');

const COURTS = schedule.tournament.courts;
const GAMES_PER_TEAM = 4;
const REFS_PER_TEAM = 2;

const ids = teams.map((t) => t.id);
const name = (id) => teams.find((t) => t.id === id)?.name ?? id;

const failures = [];
const checks = [];
const check = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
};

const poolSlots = schedule.slots.filter((s) => s.phase === 'pool');
const poolGames = poolSlots.flatMap((s) => s.games);

// --- Team ids referenced by the schedule all exist ---------------------------
const referenced = new Set();
for (const g of poolGames) [g.a, g.b, g.ref].forEach((x) => referenced.add(x));
const unknown = [...referenced].filter((id) => !ids.includes(id));
check('All referenced team ids exist in teams.json', unknown.length === 0, unknown.join(', '));

// --- Every team plays exactly 4 pool games -----------------------------------
const plays = Object.fromEntries(ids.map((id) => [id, []]));
const refs = Object.fromEntries(ids.map((id) => [id, []]));
for (const slot of poolSlots) {
  for (const g of slot.games) {
    plays[g.a]?.push(slot.slot);
    plays[g.b]?.push(slot.slot);
    refs[g.ref]?.push(slot.slot);
  }
}
for (const id of ids) {
  check(
    `${name(id)} plays exactly ${GAMES_PER_TEAM} pool games`,
    plays[id].length === GAMES_PER_TEAM,
    `plays ${plays[id].length} (slots ${plays[id].join(', ')})`
  );
}

// --- Every team referees exactly 2 -------------------------------------------
for (const id of ids) {
  check(
    `${name(id)} referees exactly ${REFS_PER_TEAM}`,
    refs[id].length === REFS_PER_TEAM,
    `refs ${refs[id].length} (slots ${refs[id].join(', ')})`
  );
}

// --- No team appears twice in the same slot, in any role ---------------------
for (const slot of poolSlots) {
  const appearances = slot.games.flatMap((g) => [g.a, g.b, g.ref]);
  const dupes = appearances.filter((x, i) => appearances.indexOf(x) !== i);
  check(
    `Slot ${slot.slot}: no team appears twice`,
    dupes.length === 0,
    dupes.map(name).join(', ')
  );
}

// --- The right number of teams are free per slot, and refs come from them ----
// With 7 teams on 2 courts, 4 play and 3 are free — one more free team than
// there are courts, so the referees are a *subset* of the free teams, not all
// of them. Each slot has exactly one genuinely idle team.
const FREE_PER_SLOT = ids.length - COURTS * 2;
for (const slot of poolSlots) {
  const playing = new Set(slot.games.flatMap((g) => [g.a, g.b]));
  const free = ids.filter((id) => !playing.has(id));
  const assignedRefs = slot.games.map((g) => g.ref);
  check(
    `Slot ${slot.slot}: exactly ${FREE_PER_SLOT} teams free`,
    free.length === FREE_PER_SLOT,
    `${free.length} free (${free.map(name).join(', ')})`
  );
  check(
    `Slot ${slot.slot}: every referee is a free team`,
    assignedRefs.every((r) => free.includes(r)),
    `free=[${free.map(name)}] refs=[${assignedRefs.map(name)}]`
  );
}

// --- Rhythm: nobody grinds out a long run, nobody goes cold ------------------
// The point of these three: a team should never sit three slots and then play
// four straight. Play in bursts of at most 2, never rest back to back, and
// never referee two slots running.
const MAX_PLAY_RUN = 2;
const slotNums = poolSlots.map((s) => s.slot);
const runOf = (list) => {
  // longest run of consecutive slot numbers present in `list`
  let best = 0;
  let run = 0;
  for (const n of slotNums) {
    run = list.includes(n) ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
};
for (const id of ids) {
  const resting = slotNums.filter((n) => !plays[id].includes(n));
  check(
    `${name(id)} never plays more than ${MAX_PLAY_RUN} slots in a row`,
    runOf(plays[id]) <= MAX_PLAY_RUN,
    `longest run ${runOf(plays[id])} (plays ${plays[id].join(', ')})`
  );
  check(
    `${name(id)} never rests two slots in a row`,
    runOf(resting) <= 1,
    `rests ${resting.join(', ')}`
  );
  check(
    `${name(id)} never referees two slots in a row`,
    runOf(refs[id]) <= 1,
    `refs ${refs[id].join(', ')}`
  );
}

// --- All 12 pairings distinct, and no team faces itself ----------------------
const pairKey = (a, b) => [a, b].sort().join(' v ');
const pairs = poolGames.map((g) => pairKey(g.a, g.b));
const dupePairs = pairs.filter((p, i) => pairs.indexOf(p) !== i);
check('All pool pairings are distinct (no rematches)', dupePairs.length === 0, dupePairs.join('; '));
check('No team plays itself', poolGames.every((g) => g.a !== g.b));
check(
  `Pool game count is ${(ids.length * GAMES_PER_TEAM) / 2}`,
  poolGames.length === (ids.length * GAMES_PER_TEAM) / 2,
  `got ${poolGames.length}`
);

// --- A referee is never one of the two teams playing that game ---------------
for (const slot of poolSlots) {
  for (const g of slot.games) {
    check(
      `Slot ${slot.slot} court ${g.court}: referee is not playing`,
      g.ref !== g.a && g.ref !== g.b,
      `${name(g.ref)} refs their own game`
    );
  }
}

// --- Game ids are unique across the whole tournament -------------------------
const allIds = schedule.slots.flatMap((s) => s.games.map((g) => g.id));
const dupeIds = allIds.filter((x, i) => allIds.indexOf(x) !== i);
check('All game ids unique', dupeIds.length === 0, dupeIds.join(', '));

// --- Courts are within range and unique per slot -----------------------------
for (const slot of schedule.slots) {
  const courts = slot.games.map((g) => g.court);
  check(
    `Slot ${slot.slot}: at most ${COURTS} concurrent games, one per court`,
    courts.length <= COURTS && new Set(courts).size === courts.length &&
      courts.every((c) => c >= 1 && c <= COURTS),
    `courts=[${courts.join(', ')}]`
  );
}

// --- Report -------------------------------------------------------------------
console.log('\n  Pool matrix — who each team faces\n');
const header = ['Team'.padEnd(22), 'Rhythm'.padEnd(18), 'Refs'.padEnd(8), 'Misses'];
console.log('  ' + header.join(''));
console.log('  ' + '─'.repeat(70));
for (const id of ids) {
  const faced = poolGames
    .filter((g) => g.a === id || g.b === id)
    .map((g) => (g.a === id ? g.b : g.a));
  const missed = ids.filter((o) => o !== id && !faced.includes(o));
  // P = playing, r = refereeing, · = genuinely free
  const rhythm = slotNums
    .map((n) => (plays[id].includes(n) ? 'P' : refs[id].includes(n) ? 'r' : '·'))
    .join(' ');
  console.log(
    '  ' +
      name(id).padEnd(22) +
      rhythm.padEnd(18) +
      `${refs[id].join(',')}`.padEnd(8) +
      missed.map(name).join(', ')
  );
}
console.log('\n  P = playing   r = refereeing   · = free\n');

const passed = checks.length - failures.length;
console.log(`\n  ${passed}/${checks.length} checks passed`);

if (failures.length) {
  console.error('\n  FAILED:\n');
  for (const f of failures) console.error(`   ✗ ${f}`);
  console.error('');
  process.exit(1);
}
console.log('  ✓ Schedule is valid\n');
