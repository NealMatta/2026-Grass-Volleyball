/**
 * Resolves bracket positions into actual teams.
 *
 * Bracket games are stored with placeholders rather than team ids: a semifinal
 * points at a seed number, the final points at the winner of a semifinal. This
 * resolves those against live standings and results.
 *
 * Pure functions — no DOM, no network.
 */

import { computeStandings, poolComplete, unresolvedTies } from './standings.js';

/** Winner / loser of a completed game. Null while it is still scheduled. */
export function winnerOf(game) {
  if (!game || game.status !== 'final') return null;
  return game.scoreA > game.scoreB ? game.teamA : game.teamB;
}

export function loserOf(game) {
  if (!game || game.status !== 'final') return null;
  return game.scoreA > game.scoreB ? game.teamB : game.teamA;
}

/**
 * Resolve one side of a bracket game to a team id, or null if not yet known.
 * Returns { teamId, source } — source is the label to show while unresolved
 * ("Seed #1", "Winner of SF1").
 */
function resolveSide(side, games, seeds) {
  const byId = (id) => games.find((g) => g.id === id);

  if (side.teamId) return { teamId: side.teamId, source: null };

  if (side.seed) {
    return { teamId: seeds[side.seed - 1] ?? null, source: `Seed #${side.seed}` };
  }
  if (side.winnerOf) {
    const g = byId(side.winnerOf);
    return { teamId: winnerOf(g), source: `Winner of ${(g?.label ?? side.winnerOf)}` };
  }
  if (side.loserOf) {
    const g = byId(side.loserOf);
    return { teamId: loserOf(g), source: `Loser of ${(g?.label ?? side.loserOf)}` };
  }
  return { teamId: null, source: null };
}

/**
 * Build the resolved bracket.
 *
 * `locked` freezes seeding using the stored order, so a late correction to a
 * pool score can't reshuffle a semifinal that is already being played.
 */
export function computeBracket(teams, games, { manualTiebreaks = {}, lockedSeeds = null } = {}) {
  const standings = computeStandings(teams, games, manualTiebreaks);
  const ties = unresolvedTies(standings);
  const complete = poolComplete(games);

  // Seeds are only trustworthy once pool play is done and nothing is tied.
  const seeds = lockedSeeds ?? (complete && ties.length === 0 ? standings.map((r) => r.id) : []);

  const bracketGames = games
    .filter((g) => g.phase === 'bracket')
    .sort((a, b) => a.slot - b.slot || a.court - b.court)
    .map((g) => {
      const a = resolveSide(
        { teamId: g.teamA, seed: g.aSeed, winnerOf: g.aWinnerOf, loserOf: g.aLoserOf },
        games,
        seeds
      );
      const b = resolveSide(
        { teamId: g.teamB, seed: g.bSeed, winnerOf: g.bWinnerOf, loserOf: g.bLoserOf },
        games,
        seeds
      );
      return { ...g, sideA: a, sideB: b, winner: winnerOf(g), ready: Boolean(a.teamId && b.teamId) };
    });

  return {
    standings,
    seeds,
    games: bracketGames,
    poolComplete: complete,
    unresolvedTies: ties,
    /** Seeding is settled and the bracket can be locked. */
    seedable: complete && ties.length === 0,
    locked: Boolean(lockedSeeds),
  };
}

/** Final placings, once everything that can be decided has been. */
export function finalPlacings(bracket) {
  const find = (id) => bracket.games.find((g) => g.id === id);
  const final = find('final');
  const third = find('third');

  const placings = [];
  if (final?.status === 'final') {
    placings.push({ place: 1, teamId: winnerOf(final) });
    placings.push({ place: 2, teamId: loserOf(final) });
  }
  if (third?.status === 'final') {
    placings.push({ place: 3, teamId: winnerOf(third) });
    placings.push({ place: 4, teamId: loserOf(third) });
  }
  // 5th and 6th are pool record only — there is no slot for a 5th place game.
  if (bracket.seeds.length === 6) {
    placings.push({ place: 5, teamId: bracket.seeds[4] });
    placings.push({ place: 6, teamId: bracket.seeds[5] });
  }
  return placings;
}
