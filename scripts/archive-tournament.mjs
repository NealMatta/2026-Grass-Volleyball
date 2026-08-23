#!/usr/bin/env node
/**
 * Freezes the finished tournament into data/history/ so it survives the reset.
 *
 * The live Supabase tables hold exactly one tournament. Running the next event
 * means clearing them, which until now destroyed the previous result — the
 * August 22 tournament existed only as rows that the next reset would delete.
 * This writes a permanent copy into the repo before that happens.
 *
 * Read-only against Supabase. It uses the same public anon key the site does,
 * so it needs no service-role key, no passcode, and no edge function: RLS
 * already grants exactly the read access this needs and nothing more.
 *
 * The maths is not reimplemented here. Standings, seeding and final placings
 * come from the same modules the browser uses, so an archived tournament says
 * precisely what the site said on the day.
 *
 * Run: node scripts/archive-tournament.mjs [--slug my-slug] [--force]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeStandings } from '../js/standings.js';
import { computeBracket, finalPlacings, winnerOf, loserOf } from '../js/bracket.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const historyDir = join(root, 'data', 'history');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? true;
};
const FORCE = args.includes('--force');

/* ── credentials, read out of the site's own data layer ─────────────────────
 * Parsed rather than imported because js/data.js pulls in browser globals.
 * One source of truth for the URL and key, no second copy to drift. */
const dataSrc = readFileSync(join(root, 'js', 'data.js'), 'utf8');
const SUPABASE_URL = dataSrc.match(/const SUPABASE_URL = '([^']+)'/)?.[1];
const ANON_KEY = dataSrc.match(/'(eyJ[A-Za-z0-9._-]+)'/)?.[1];
if (!SUPABASE_URL || !ANON_KEY) {
  console.error('  ✗ Could not read the Supabase URL or anon key out of js/data.js');
  process.exit(1);
}

const headers = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

async function getJSON(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path} — ${res.status} ${res.statusText}`);
  return res.json();
}

/* ── shapes the standings modules expect ──────────────────────────────────── */

const mapTeam = (t) => ({
  id: t.id,
  name: t.name,
  seed: t.seed,
  captain: t.captain,
  players: t.players ?? [],
  hasNet: t.has_net,
  colorA: t.color_a,
  colorB: t.color_b,
  blurb: t.blurb,
});

const mapGame = (g) => ({
  id: g.id,
  slot: g.slot,
  phase: g.phase,
  court: g.court,
  time: g.start_time,
  label: g.label,
  teamA: g.team_a,
  teamB: g.team_b,
  aSeed: g.a_seed,
  bSeed: g.b_seed,
  aWinnerOf: g.a_winner_of,
  bWinnerOf: g.b_winner_of,
  aLoserOf: g.a_loser_of,
  bLoserOf: g.b_loser_of,
  scoreA: g.score_a,
  scoreB: g.score_b,
  status: g.status,
  forfeitBy: g.forfeit_by ?? null,
});

/**
 * The archive filename. `tournament.slug` in data/schedule.json sets the stable
 * half ("grass-volleyball"), the date makes it unique. Deriving the whole thing
 * from the tournament name instead produced "2026-08-22-2026-grass-volleyball"
 * — the year twice — and gets worse the longer the series name is.
 */
const slugify = (date, meta) => {
  const stem = (meta.slug ?? meta.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${date}-${stem}`.replace(/-+/g, '-');
};

const ordinal = (n) => ['', '1st', '2nd', '3rd'][n] ?? `${n}th`;

/* ── build the record ─────────────────────────────────────────────────────── */

async function main() {
  const schedule = JSON.parse(readFileSync(join(root, 'data', 'schedule.json'), 'utf8'));
  const meta = schedule.tournament;

  console.log(`Archiving ${meta.name} — ${meta.date}\n`);

  const [rawTeams, rawGames, rawState] = await Promise.all([
    getJSON('teams?select=*&order=seed'),
    getJSON('games?select=*&order=slot,court'),
    getJSON('tournament_state?select=*&id=eq.1'),
  ]);

  const teams = rawTeams.map(mapTeam);
  const games = rawGames.map(mapGame);
  const state = rawState[0] ?? {};
  const manualTiebreaks = state.manual_tiebreaks ?? {};
  const lockedSeeds = state.locked_seeds ?? null;

  if (!teams.length) {
    console.error('  ✗ No teams in the database — nothing to archive.');
    process.exit(1);
  }

  const unplayed = games.filter((g) => g.status !== 'final');
  if (unplayed.length && !FORCE) {
    console.error(`  ✗ ${unplayed.length} game${unplayed.length > 1 ? 's are' : ' is'} still unplayed:`);
    for (const g of unplayed) console.error(`     ${g.id}${g.label ? ` (${g.label})` : ''}`);
    console.error('\n  Archiving now would freeze an unfinished tournament.');
    console.error('  Finish the games, or pass --force if this is deliberate.');
    process.exit(1);
  }

  const byId = new Map(teams.map((t) => [t.id, t]));
  const nameOf = (id) => byId.get(id)?.name ?? null;

  const standings = computeStandings(teams, games, manualTiebreaks);
  const bracket = computeBracket(teams, games, { manualTiebreaks, lockedSeeds });
  const placings = finalPlacings(bracket);

  // Podium — the top three, with rosters, so a banner needs no lookups.
  const podium = placings
    .filter((p) => p.place <= 3)
    .map((p) => {
      const team = byId.get(p.teamId);
      const decider = bracket.games.find(
        (g) => (g.id === 'final' && p.place <= 2) || (g.id === 'third' && p.place === 3)
      );
      return {
        place: p.place,
        teamId: p.teamId,
        name: team?.name ?? p.teamId,
        players: team?.players ?? [],
        colorA: team?.colorA ?? null,
        colorB: team?.colorB ?? null,
        note: describeResult(decider, p.teamId, p.place),
      };
    });

  /** "def. Cinnamon Rolls 25-17", "lost the final 17-25", "won by concession". */
  function describeResult(game, teamId, place) {
    if (!game || game.status !== 'final') return ordinal(place);
    const won = winnerOf(game) === teamId;
    const other = nameOf(won ? loserOf(game) : winnerOf(game));
    if (game.forfeitBy) {
      return won ? `won by concession over ${other}` : `conceded to ${other}`;
    }
    const mine = game.teamA === teamId ? game.scoreA : game.scoreB;
    const theirs = game.teamA === teamId ? game.scoreB : game.scoreA;
    return won ? `def. ${other} ${mine}-${theirs}` : `lost to ${other} ${mine}-${theirs}`;
  }

  const record = {
    _comment:
      'Frozen record of a finished tournament. Generated by scripts/archive-tournament.mjs — ' +
      'do not hand-edit. NO emails or phone numbers, ever: this repo is public.',
    slug: flag('slug') || slugify(meta.date, meta),
    name: meta.name,
    date: meta.date,
    dayOfWeek: meta.dayOfWeek ?? null,
    venue: meta.venue ?? null,
    venueNote: meta.venueNote ?? null,
    mapUrl: meta.mapUrl ?? null,
    courts: meta.courts ?? null,
    archivedAt: new Date().toISOString().slice(0, 10),

    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      captain: t.captain,
      players: t.players,
      colorA: t.colorA,
      colorB: t.colorB,
      blurb: t.blurb ?? null,
    })),

    podium,

    // Every final position, not just the podium. Places 1-4 are decided by the
    // bracket; below that the pool table stands, which is what finalPlacings
    // already encodes.
    placings: placings.map((p) => ({
      place: p.place,
      teamId: p.teamId,
      name: nameOf(p.teamId) ?? p.teamId,
    })),

    // Final pool table, in finishing order, with the tiebreaker that settled it.
    pool: standings.map((row, i) => ({
      pos: i + 1,
      teamId: row.id,
      name: row.team.name,
      colorA: row.team.colorA,
      wins: row.wins,
      losses: row.losses,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
      diff: row.diff,
      qualified: i < 4,
      brokeTieOn: row.brokeTieOn ?? null,
    })),

    // Every game, pool and bracket, exactly as played.
    games: games.map((g) => ({
      id: g.id,
      slot: g.slot,
      phase: g.phase,
      court: g.court,
      time: g.time,
      label: g.label,
      teamA: g.teamA,
      teamAName: nameOf(g.teamA),
      teamB: g.teamB,
      teamBName: nameOf(g.teamB),
      scoreA: g.scoreA,
      scoreB: g.scoreB,
      forfeitBy: g.forfeitBy,
      forfeitByName: g.forfeitBy ? nameOf(g.forfeitBy) : null,
      status: g.status,
      winner: g.status === 'final' ? winnerOf(g) : null,
    })),
  };

  // ── write it ──
  mkdirSync(historyDir, { recursive: true });
  const file = join(historyDir, `${record.slug}.json`);
  if (existsSync(file) && !FORCE) {
    console.error(`  ✗ ${record.slug}.json already exists.`);
    console.error('  Pass --force to overwrite it, or --slug to file this under another name.');
    process.exit(1);
  }
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);

  // ── rebuild the index from whatever is on disk, so it can never drift ──
  const entries = readdirSync(historyDir)
    .filter((f) => f.endsWith('.json') && f !== 'index.json')
    .map((f) => JSON.parse(readFileSync(join(historyDir, f), 'utf8')))
    .map((r) => {
      const champ = r.podium.find((p) => p.place === 1);
      return {
        slug: r.slug,
        name: r.name,
        date: r.date,
        venue: r.venue,
        teamCount: r.teams.length,
        champion: champ
          ? { name: champ.name, players: champ.players, colorA: champ.colorA, colorB: champ.colorB }
          : null,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));   // newest first

  writeFileSync(
    join(historyDir, 'index.json'),
    `${JSON.stringify({
      _comment:
        'Index of archived tournaments, newest first. Everything the banner wall needs, so ' +
        'history.html can draw banners without loading every full record. Regenerated by ' +
        'scripts/archive-tournament.mjs.',
      tournaments: entries,
    }, null, 2)}\n`
  );

  // ── report ──
  const champ = podium.find((p) => p.place === 1);
  console.log(`  ✓ data/history/${record.slug}.json`);
  console.log(`  ✓ data/history/index.json — ${entries.length} tournament${entries.length > 1 ? 's' : ''}\n`);
  console.log(`  Champion   ${champ?.name ?? '—'} (${champ?.players.join(', ') ?? ''})`);
  for (const p of podium.filter((x) => x.place > 1)) {
    console.log(`  ${ordinal(p.place).padEnd(10)} ${p.name} — ${p.note}`);
  }
  console.log(`\n  Pool: ${record.pool.map((r) => r.name).join(' · ')}`);
  console.log('\n  Commit this file. It is the only copy once the tables are reset.');
}

main().catch((err) => {
  console.error(`  ✗ ${err.message}`);
  process.exit(1);
});
