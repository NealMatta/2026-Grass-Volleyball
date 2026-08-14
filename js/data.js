/**
 * Data access.
 *
 * Deliberately no supabase-js: this site gets used in a lakefront park on
 * phone data. A 15-second poll over plain fetch is more resilient to dropped
 * connections than a websocket, costs no CDN dependency, and scores only
 * change every ~25 minutes anyway.
 *
 * If the network is unavailable entirely, we fall back to the bundled JSON so
 * the schedule, rules and rosters still render. Standings just won't be live.
 */

const SUPABASE_URL = 'https://yxmkothzqvyptftedlen.supabase.co';

// Public by design — this key only grants the read-only access defined by RLS.
// All writes go through the submit-score function, which requires the passcode.
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl4bWtvdGh6cXZ5cHRmdGVkbGVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NTYzMTIsImV4cCI6MjEwMjIzMjMxMn0.t-N0uqb0dWKKJCWtPZKmZ76SzYw1rt2gUIGYxgUTJeI';

const REST = `${SUPABASE_URL}/rest/v1`;
const authHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

export const POLL_MS = 15000;

const mapTeam = (t) => ({
  id: t.id,
  name: t.name,
  seed: t.seed,
  captain: t.captain,
  players: t.players ?? [],
  rosterPending: t.roster_pending ?? 0,
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
  refTeam: g.ref_team,
  aSeed: g.a_seed,
  bSeed: g.b_seed,
  aWinnerOf: g.a_winner_of,
  bWinnerOf: g.b_winner_of,
  aLoserOf: g.a_loser_of,
  bLoserOf: g.b_loser_of,
  scoreA: g.score_a,
  scoreB: g.score_b,
  status: g.status,
});

async function getJSON(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Build the same shape from the bundled JSON, for the offline path. */
async function loadBundled() {
  const [teamsDoc, scheduleDoc] = await Promise.all([
    getJSON('data/teams.json'),
    getJSON('data/schedule.json'),
  ]);

  const games = scheduleDoc.slots.flatMap((slot) =>
    slot.games.map((g) => ({
      id: g.id,
      slot: slot.slot,
      phase: slot.phase,
      court: g.court,
      time: slot.time,
      label: g.label ?? null,
      teamA: typeof g.a === 'string' ? g.a : null,
      teamB: typeof g.b === 'string' ? g.b : null,
      refTeam: g.ref ?? null,
      aSeed: typeof g.a === 'object' ? g.a.seed ?? null : null,
      bSeed: typeof g.b === 'object' ? g.b.seed ?? null : null,
      aWinnerOf: typeof g.a === 'object' ? g.a.winnerOf ?? null : null,
      bWinnerOf: typeof g.b === 'object' ? g.b.winnerOf ?? null : null,
      aLoserOf: typeof g.a === 'object' ? g.a.loserOf ?? null : null,
      bLoserOf: typeof g.b === 'object' ? g.b.loserOf ?? null : null,
      scoreA: null,
      scoreB: null,
      status: 'scheduled',
    }))
  );

  return {
    teams: teamsDoc.teams.map((t) => ({ ...t, rosterPending: t.rosterPending ?? 0 })),
    games,
    state: { bracketLocked: false, manualTiebreaks: {}, lockedSeeds: null },
    tournament: scheduleDoc.tournament,
    offline: true,
  };
}

/** Everything the page needs, in one round trip each. */
export async function fetchAll() {
  const tournamentPromise = getJSON('data/schedule.json').then((d) => d.tournament).catch(() => null);

  try {
    const [teams, games, state] = await Promise.all([
      getJSON(`${REST}/teams?select=*&order=seed`, { headers: authHeaders }),
      getJSON(`${REST}/games?select=*&order=slot,court`, { headers: authHeaders }),
      getJSON(`${REST}/tournament_state?select=*&id=eq.1`, { headers: authHeaders }),
    ]);

    const s = state[0] ?? {};
    return {
      teams: teams.map(mapTeam),
      games: games.map(mapGame),
      state: {
        bracketLocked: Boolean(s.bracket_locked),
        manualTiebreaks: s.manual_tiebreaks ?? {},
        lockedSeeds: s.locked_seeds ?? null,
      },
      tournament: await tournamentPromise,
      offline: false,
    };
  } catch (err) {
    console.warn('Live data unavailable, falling back to bundled schedule:', err.message);
    return loadBundled();
  }
}

/**
 * Submit or correct a score. Goes through the edge function, which checks the
 * passcode server-side — the anon key cannot write to games directly.
 */
export async function submitScore({ gameId, scoreA, scoreB, passcode }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-score`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'score', gameId, scoreA, scoreB, passcode }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Submit failed (${res.status})`);
  return body;
}

/** Reopen a final game so it can be corrected. */
export async function reopenGame({ gameId, passcode }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-score`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'reopen', gameId, passcode }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Reopen failed (${res.status})`);
  return body;
}

/** Lock or unlock bracket seeding, or record a manual tiebreak decision. */
export async function updateState({ passcode, bracketLocked, lockedSeeds, manualTiebreaks }) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-score`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'state', passcode, bracketLocked, lockedSeeds, manualTiebreaks }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Update failed (${res.status})`);
  return body;
}

/** Verify a passcode without changing anything. */
export async function checkPasscode(passcode) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-score`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'check', passcode }),
  });
  return res.ok;
}
