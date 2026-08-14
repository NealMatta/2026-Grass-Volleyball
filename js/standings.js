/**
 * Standings and the tiebreaker chain.
 *
 * Pure functions — no DOM, no network. Runs in the browser and under node, so
 * the tiebreaker logic can be unit tested (scripts/test-standings.mjs).
 *
 * Tiebreakers, in order:
 *   1. Wins
 *   2. Head-to-head (mini-league among only the tied teams)
 *   3. Point differential
 *   4. Points scored
 *   5. Rock paper scissors  <- cannot be computed; surfaced for a human to settle
 */

/** Head-to-head record for one team against a specific set of opponents. */
function headToHead(id, opponents, poolGames) {
  let wins = 0;
  let pf = 0;
  let pa = 0;
  let played = 0;

  for (const g of poolGames) {
    const isA = g.teamA === id && opponents.includes(g.teamB);
    const isB = g.teamB === id && opponents.includes(g.teamA);
    if (!isA && !isB) continue;

    played += 1;
    const mine = isA ? g.scoreA : g.scoreB;
    const theirs = isA ? g.scoreB : g.scoreA;
    pf += mine;
    pa += theirs;
    if (mine > theirs) wins += 1;
  }

  return { wins, played, diff: pf - pa };
}

/** Aggregate per-team pool record. */
export function computeRecords(teams, games) {
  const poolGames = games.filter((g) => g.phase === 'pool' && g.status === 'final');

  const records = new Map(
    teams.map((t) => [
      t.id,
      { id: t.id, team: t, played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, diff: 0 },
    ])
  );

  for (const g of poolGames) {
    const a = records.get(g.teamA);
    const b = records.get(g.teamB);
    if (!a || !b) continue;

    a.played += 1;
    b.played += 1;
    a.pointsFor += g.scoreA;
    a.pointsAgainst += g.scoreB;
    b.pointsFor += g.scoreB;
    b.pointsAgainst += g.scoreA;

    if (g.scoreA > g.scoreB) {
      a.wins += 1;
      b.losses += 1;
    } else {
      b.wins += 1;
      a.losses += 1;
    }
  }

  for (const r of records.values()) r.diff = r.pointsFor - r.pointsAgainst;
  return records;
}

/** Stable key for a set of tied teams, used to look up a manual decision. */
export function tieKey(ids) {
  return [...ids].sort().join('|');
}

/**
 * Rank all teams. Returns rows in seed order (index 0 = seed #1).
 *
 * Each row carries `tiedWith` — the other teams it could not be separated from
 * by any computable rule. Non-empty means a human has to settle it; the UI must
 * surface that rather than silently trusting the array order.
 */
export function computeStandings(teams, games, manualTiebreaks = {}) {
  const poolGames = games.filter((g) => g.phase === 'pool' && g.status === 'final');
  const records = computeRecords(teams, games);
  const rows = [...records.values()];

  // Group by wins, then resolve within each group.
  const byWins = new Map();
  for (const r of rows) {
    if (!byWins.has(r.wins)) byWins.set(r.wins, []);
    byWins.get(r.wins).push(r);
  }

  const ranked = [];
  const winTiers = [...byWins.keys()].sort((x, y) => y - x);

  for (const w of winTiers) {
    const group = byWins.get(w);

    if (group.length === 1) {
      ranked.push({ ...group[0], tiedWith: [] });
      continue;
    }

    const ids = group.map((r) => r.id);
    const h2h = new Map(ids.map((id) => [id, headToHead(id, ids.filter((o) => o !== id), poolGames)]));

    const sorted = [...group].sort((a, b) => {
      const ha = h2h.get(a.id);
      const hb = h2h.get(b.id);
      return (
        hb.wins - ha.wins ||     // 2. head-to-head
        hb.diff - ha.diff ||     //    …then margin in those meetings
        b.diff - a.diff ||       // 3. overall point differential
        b.pointsFor - a.pointsFor // 4. points scored
      );
    });

    // Anything still identical on every computable measure needs a human.
    const separable = (a, b) => {
      const ha = h2h.get(a.id);
      const hb = h2h.get(b.id);
      return (
        ha.wins !== hb.wins ||
        ha.diff !== hb.diff ||
        a.diff !== b.diff ||
        a.pointsFor !== b.pointsFor
      );
    };

    const clusters = [];
    for (const row of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && !separable(last[0], row)) last.push(row);
      else clusters.push([row]);
    }

    for (const cluster of clusters) {
      if (cluster.length === 1) {
        ranked.push({ ...cluster[0], tiedWith: [] });
        continue;
      }

      // A manual decision, if Neal has made one, is an explicit order of ids.
      const decision = manualTiebreaks[tieKey(cluster.map((r) => r.id))];
      const ordered = decision
        ? decision.map((id) => cluster.find((r) => r.id === id)).filter(Boolean)
        : cluster;
      const leftovers = cluster.filter((r) => !ordered.includes(r));

      for (const row of [...ordered, ...leftovers]) {
        ranked.push({
          ...row,
          // Once settled manually it is no longer an open tie.
          tiedWith: decision ? [] : cluster.filter((o) => o.id !== row.id).map((o) => o.id),
        });
      }
    }
  }

  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Open ties a human still needs to settle. Empty when seeding is safe to use. */
export function unresolvedTies(standings) {
  const seen = new Set();
  const out = [];
  for (const row of standings) {
    if (!row.tiedWith.length) continue;
    const key = tieKey([row.id, ...row.tiedWith]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, ids: [row.id, ...row.tiedWith].sort() });
  }
  return out;
}

/** True once every pool game has a final score. */
export function poolComplete(games) {
  const pool = games.filter((g) => g.phase === 'pool');
  return pool.length > 0 && pool.every((g) => g.status === 'final');
}
