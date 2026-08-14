/**
 * submit-score — the only path that can write to the tournament.
 *
 * Open by design: anyone can post a score, no passcode. Neal's call — it's a
 * friendly tournament and chasing one organiser for every result is worse than
 * the risk of someone typing the wrong number. Every action is reversible from
 * the same panel, so a bad entry is a 10-second fix.
 *
 * This still isn't a free-for-all write path. RLS gives the anon key read-only
 * access, so the browser can't touch the tables directly; everything comes
 * through here, where scores get validated (whole numbers, in range, no ties)
 * and bracket games are refused until both teams are actually known.
 *
 * To put a passcode back: set an ADMIN_PASSCODE secret and reinstate the check
 * marked below, plus the `check` action and the passcode field in js/admin.js.
 *
 * Env (provided automatically by Supabase):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Actions: score | reopen | state
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const MAX_SCORE = 99;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  // ── Passcode check would go here ──

  const action = String(payload.action ?? 'score');

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  // --- Record or correct a score --------------------------------------------
  if (action === 'score') {
    const gameId = String(payload.gameId ?? '');
    const scoreA = Number(payload.scoreA);
    const scoreB = Number(payload.scoreB);

    if (!gameId) return json({ error: 'Which game?' }, 400);
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
      return json({ error: 'Both scores must be whole numbers' }, 400);
    }
    if (scoreA < 0 || scoreB < 0 || scoreA > MAX_SCORE || scoreB > MAX_SCORE) {
      return json({ error: `Scores must be between 0 and ${MAX_SCORE}` }, 400);
    }
    if (scoreA === scoreB) {
      return json({ error: 'Volleyball has no ties — one team has to win' }, 400);
    }

    const { data: game, error: readErr } = await db
      .from('games')
      .select('id, phase, team_a, team_b, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of')
      .eq('id', gameId)
      .maybeSingle();

    if (readErr) return json({ error: readErr.message }, 500);
    if (!game) return json({ error: `No game called ${gameId}` }, 404);

    // A bracket game has no teams until the prior round resolves. Fill them in
    // now so the result is meaningful on its own, and refuse if it isn't ready.
    const patch: Record<string, unknown> = {
      score_a: scoreA,
      score_b: scoreB,
      status: 'final',
      updated_at: new Date().toISOString(),
    };

    if (game.phase === 'bracket' && (!game.team_a || !game.team_b)) {
      const resolved = await resolveBracketSides(db, game);
      if (!resolved) {
        return json({ error: 'That game does not have both teams yet' }, 409);
      }
      patch.team_a = resolved.teamA;
      patch.team_b = resolved.teamB;
    }

    const { error } = await db.from('games').update(patch).eq('id', gameId);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, gameId, scoreA, scoreB });
  }

  // --- Reopen a game for correction -----------------------------------------
  if (action === 'reopen') {
    const gameId = String(payload.gameId ?? '');
    if (!gameId) return json({ error: 'Which game?' }, 400);

    const { data: game } = await db
      .from('games')
      .select('phase, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of')
      .eq('id', gameId)
      .maybeSingle();

    const patch: Record<string, unknown> = {
      score_a: null,
      score_b: null,
      status: 'scheduled',
      updated_at: new Date().toISOString(),
    };

    // A bracket game's teams are filled in when it's scored. Clearing the score
    // has to clear those too, or the game keeps teams from the result we just
    // undid — which would show decided semifinals before pool play is done.
    // Only clear sides that are derived; a side has to be re-derivable.
    if (game?.phase === 'bracket') {
      if (game.a_seed || game.a_winner_of || game.a_loser_of) patch.team_a = null;
      if (game.b_seed || game.b_winner_of || game.b_loser_of) patch.team_b = null;
    }

    const { error } = await db.from('games').update(patch).eq('id', gameId);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, gameId });
  }

  // --- Bracket lock and manual tiebreaks ------------------------------------
  if (action === 'state') {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (payload.bracketLocked !== undefined) patch.bracket_locked = Boolean(payload.bracketLocked);
    if (payload.lockedSeeds !== undefined) patch.locked_seeds = payload.lockedSeeds;
    if (payload.manualTiebreaks !== undefined) patch.manual_tiebreaks = payload.manualTiebreaks;

    const { error } = await db.from('tournament_state').update(patch).eq('id', 1);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: `Unknown action "${action}"` }, 400);
});

/** Resolve a bracket game's two sides from seeds or prior-round results. */
async function resolveBracketSides(
  db: ReturnType<typeof createClient>,
  game: Record<string, string | number | null>
): Promise<{ teamA: string; teamB: string } | null> {
  const { data: state } = await db
    .from('tournament_state')
    .select('locked_seeds')
    .eq('id', 1)
    .maybeSingle();

  const seeds: string[] = state?.locked_seeds ?? [];

  const sideFrom = async (
    seed: number | null,
    winnerOf: string | null,
    loserOf: string | null
  ): Promise<string | null> => {
    if (seed) return seeds[seed - 1] ?? null;

    const sourceId = winnerOf ?? loserOf;
    if (!sourceId) return null;

    const { data: src } = await db
      .from('games')
      .select('team_a, team_b, score_a, score_b, status')
      .eq('id', sourceId)
      .maybeSingle();

    if (!src || src.status !== 'final') return null;
    const winner = src.score_a > src.score_b ? src.team_a : src.team_b;
    const loser = src.score_a > src.score_b ? src.team_b : src.team_a;
    return winnerOf ? winner : loser;
  };

  const teamA = await sideFrom(
    game.a_seed as number | null,
    game.a_winner_of as string | null,
    game.a_loser_of as string | null
  );
  const teamB = await sideFrom(
    game.b_seed as number | null,
    game.b_winner_of as string | null,
    game.b_loser_of as string | null
  );

  if (!teamA || !teamB || teamA === teamB) return null;
  return { teamA, teamB };
}
