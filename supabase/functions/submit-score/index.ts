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
 * "Known" means derived here, from the same standings module the browser uses
 * (supabase/functions/_shared/standings.js) — not merely read out of
 * locked_seeds. Seeding is real the moment pool play ends with no dead heat,
 * and the phone shows the semifinals that way; requiring someone to have hit
 * "Lock seeding" first is what made scoring a semifinal fail with "that game
 * does not have both teams yet" while the screen named both teams.
 *
 * To put a passcode back: set an ADMIN_PASSCODE secret and reinstate the check
 * marked below, plus the `check` action and the passcode field in js/admin.js.
 *
 * Env (provided automatically by Supabase):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Actions: score | reopen | state
 *
 * A score submission may carry `forfeitBy` instead of scores, for a game that
 * was never played -- see the score branch below.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { computeStandings, unresolvedTies, poolComplete } from '../_shared/standings.js';

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
    if (!gameId) return json({ error: 'Which game?' }, 400);

    // A forfeit is a game nobody played. It carries no scores of its own --
    // the nominal 1-0 written below is what lets standings still resolve a
    // winner without a game that never happened moving anyone's point
    // differential. Validated after the teams are known, since a bracket game
    // may not have them yet.
    const forfeitBy = payload.forfeitBy ? String(payload.forfeitBy) : null;

    const scoreA = Number(payload.scoreA);
    const scoreB = Number(payload.scoreB);

    if (!forfeitBy) {
      if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
        return json({ error: 'Both scores must be whole numbers' }, 400);
      }
      if (scoreA < 0 || scoreB < 0 || scoreA > MAX_SCORE || scoreB > MAX_SCORE) {
        return json({ error: `Scores must be between 0 and ${MAX_SCORE}` }, 400);
      }
      if (scoreA === scoreB) {
        return json({ error: 'Volleyball has no ties — one team has to win' }, 400);
      }
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
      status: 'final',
      updated_at: new Date().toISOString(),
    };

    let freezeSeeds: string[] | null = null;
    let teamA = game.team_a as string | null;
    let teamB = game.team_b as string | null;

    if (game.phase === 'bracket' && (!teamA || !teamB)) {
      const resolved = await resolveBracketSides(db, game);
      if ('error' in resolved) return json({ error: resolved.error }, 409);
      teamA = resolved.teamA;
      teamB = resolved.teamB;
      patch.team_a = teamA;
      patch.team_b = teamB;
      freezeSeeds = resolved.freezeSeeds;
    }

    if (forfeitBy) {
      if (forfeitBy !== teamA && forfeitBy !== teamB) {
        return json({ error: 'Only a team playing that game can concede it' }, 400);
      }
      // Nominal, deliberately minimal: enough to decide a winner, small enough
      // that a game nobody played barely touches point differential.
      patch.score_a = forfeitBy === teamA ? 0 : 1;
      patch.score_b = forfeitBy === teamA ? 1 : 0;
      patch.forfeit_by = forfeitBy;
    } else {
      patch.score_a = scoreA;
      patch.score_b = scoreB;
      // Correcting a forfeit to a real score has to clear the flag, or the
      // game keeps reading "Conceded" over a scoreline that was actually played.
      patch.forfeit_by = null;
    }

    const { error } = await db.from('games').update(patch).eq('id', gameId);
    if (error) return json({ error: error.message }, 500);

    // Scoring a bracket game settles the seeding it was drawn from. Freeze it
    // so a later pool correction can't reshuffle a semifinal already played.
    if (freezeSeeds) {
      await db
        .from('tournament_state')
        .update({ bracket_locked: true, locked_seeds: freezeSeeds, updated_at: new Date().toISOString() })
        .eq('id', 1);
    }

    return json({
      ok: true,
      gameId,
      scoreA: patch.score_a,
      scoreB: patch.score_b,
      forfeitBy: patch.forfeit_by ?? null,
    });
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
      // Must be cleared alongside the status: the forfeit_is_final constraint
      // only allows forfeit_by on a final game, so leaving it set here would
      // make reopening a conceded game fail outright.
      forfeit_by: null,
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

type Sides = { teamA: string; teamB: string; freezeSeeds: string[] | null };
type Refusal = { error: string };

/** The DB's snake_case game row in the shape js/standings.js expects. */
const mapGame = (g: Record<string, unknown>) => ({
  id: g.id,
  phase: g.phase,
  teamA: g.team_a,
  teamB: g.team_b,
  scoreA: g.score_a,
  scoreB: g.score_b,
  status: g.status,
});

/**
 * The seed order the bracket draws from, 1st seed first.
 *
 * Prefers the frozen order once seeding is locked. Otherwise it derives the
 * order the same way the browser does — same module, same tiebreaker chain —
 * because the phone will happily show "Semifinal 1: Tequila Mockingbird v Deez
 * Nets" off a live computation, and a server that only trusted locked_seeds
 * would then refuse the score for a game it was displaying as ready to play.
 * Refusals here have to be reasons, not a flat "no teams yet".
 */
async function seedOrder(
  db: ReturnType<typeof createClient>
): Promise<{ seeds: string[]; frozen: boolean } | Refusal> {
  const { data: state } = await db
    .from('tournament_state')
    .select('locked_seeds, manual_tiebreaks')
    .eq('id', 1)
    .maybeSingle();

  const locked: string[] = state?.locked_seeds ?? [];
  if (locked.length) return { seeds: locked, frozen: true };

  const [{ data: teams }, { data: rows }] = await Promise.all([
    db.from('teams').select('id, name'),
    db.from('games').select('id, phase, team_a, team_b, score_a, score_b, status'),
  ]);

  if (!teams?.length || !rows?.length) return { error: 'Could not read the tournament to work out seeding' };

  const games = rows.map(mapGame);
  const unplayed = games.filter((g) => g.phase === 'pool' && g.status !== 'final').length;
  if (!poolComplete(games)) {
    return {
      error: unplayed === 1
        ? 'One pool game still needs a score before the bracket can be seeded'
        : `${unplayed} pool games still need scores before the bracket can be seeded`,
    };
  }

  const standings = computeStandings(teams, games, state?.manual_tiebreaks ?? {});
  const ties = unresolvedTies(standings);
  if (ties.length) {
    const nameOf = (id: string) => teams.find((t) => t.id === id)?.name ?? id;
    return {
      error: `${ties[0].ids.map(nameOf).join(' and ')} are dead level — settle that tie before scoring the bracket`,
    };
  }

  return { seeds: standings.map((r: { id: string }) => r.id), frozen: false };
}

/** Resolve a bracket game's two sides from seeds or prior-round results. */
async function resolveBracketSides(
  db: ReturnType<typeof createClient>,
  game: Record<string, string | number | null>
): Promise<Sides | Refusal> {
  const needsSeeds = Boolean(game.a_seed || game.b_seed);
  let seeds: string[] = [];
  let frozen = false;

  if (needsSeeds) {
    const order = await seedOrder(db);
    if ('error' in order) return order;
    seeds = order.seeds;
    frozen = order.frozen;
  }

  /** One side: a seed number, or the winner/loser of an earlier game. */
  const sideFrom = async (
    seed: number | null,
    winnerOf: string | null,
    loserOf: string | null
  ): Promise<{ team: string } | Refusal> => {
    if (seed) {
      const team = seeds[seed - 1];
      return team ? { team } : { error: `There is no seed #${seed} — only ${seeds.length} teams are seeded` };
    }

    const sourceId = winnerOf ?? loserOf;
    if (!sourceId) return { error: 'That game has no team on one side' };

    const { data: src } = await db
      .from('games')
      .select('label, team_a, team_b, score_a, score_b, status')
      .eq('id', sourceId)
      .maybeSingle();

    if (!src) return { error: `Cannot find ${sourceId}` };
    if (src.status !== 'final') {
      return { error: `${src.label ?? sourceId} has not been scored yet` };
    }

    const aWon = src.score_a > src.score_b;
    const team = winnerOf ? (aWon ? src.team_a : src.team_b) : (aWon ? src.team_b : src.team_a);
    return team ? { team } : { error: `${src.label ?? sourceId} has no teams recorded` };
  };

  const a = await sideFrom(
    game.a_seed as number | null,
    game.a_winner_of as string | null,
    game.a_loser_of as string | null
  );
  if ('error' in a) return a;

  const b = await sideFrom(
    game.b_seed as number | null,
    game.b_winner_of as string | null,
    game.b_loser_of as string | null
  );
  if ('error' in b) return b;

  if (a.team === b.team) return { error: 'Both sides resolved to the same team — check the earlier results' };

  // Only worth freezing if this draw actually came off a live seed computation.
  return { teamA: a.team, teamB: b.team, freezeSeeds: needsSeeds && !frozen ? seeds : null };
}
