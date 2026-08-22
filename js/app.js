/**
 * Renders the page and drives the 15s refresh.
 *
 * All tournament maths lives in standings.js / bracket.js — this file is
 * presentation and event wiring only.
 */

import { fetchAll, POLL_MS } from './data.js';
import { computeStandings, unresolvedTies, poolComplete } from './standings.js';
import { computeBracket, finalPlacings } from './bracket.js';
import { mountAdmin } from './admin.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** State shared with the admin panel. */
const store = {
  teams: [],
  games: [],
  state: { bracketLocked: false, manualTiebreaks: {}, lockedSeeds: null },
  tournament: null,
  offline: false,
  byId: new Map(),
  refresh: null,
};

const teamName = (id) => store.byId.get(id)?.name ?? '—';
const swatch = (id) => {
  const t = store.byId.get(id);
  const s = el('span', 'swatch');
  s.style.background = t ? `linear-gradient(${t.colorA}, ${t.colorB})` : 'var(--chalk-faint)';
  return s;
};

/** Relative luminance, so light team colours get dark text instead of white. */
function luminance(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Text colour that stays readable on a team's gradient. */
function inkFor(team) {
  const avg = (luminance(team.colorA) + luminance(team.colorB)) / 2;
  return avg > 0.35 ? { fg: '#0B1F12', sub: 'rgba(11,31,18,.75)' } : { fg: '#F2F5E8', sub: 'rgba(255,255,255,.85)' };
}

/* ---------------------------------------------------------------- motion -- */

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fade sections up as they scroll into view. */
function mountReveal() {
  const targets = document.querySelectorAll('.section > *');
  if (!('IntersectionObserver' in window) || reduceMotion()) {
    targets.forEach((n) => n.classList.add('reveal', 'in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
  );
  targets.forEach((n) => { n.classList.add('reveal'); io.observe(n); });
}

/**
 * FLIP: run `rebuild`, then animate rows from where they were to where they
 * landed. Makes a team climbing the table after a win legible instead of the
 * whole board silently teleporting.
 */
function flipRows(container, rebuild) {
  const before = new Map();
  for (const row of container.children) {
    if (row.dataset.team) before.set(row.dataset.team, row.getBoundingClientRect().top);
  }

  rebuild();

  if (!before.size || reduceMotion()) return;

  for (const row of container.children) {
    const from = before.get(row.dataset.team);
    if (from == null) continue;
    const delta = from - row.getBoundingClientRect().top;
    if (Math.abs(delta) < 1) continue;

    row.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: 'none' }],
      { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' }
    );
    row.classList.add('moved');
    row.addEventListener('animationend', () => row.classList.remove('moved'), { once: true });
  }
}

/** Game ids whose score we've already shown, so a pop only fires on arrival. */
const seenFinal = new Set();

/* ------------------------------------------------------------------ time -- */

/** Schedule times are 12-hour with no meridiem; anything before 8 is PM. */
function slotDate(timeStr) {
  const d = store.tournament?.date;
  if (!d) return null;
  const [h, m] = timeStr.split(':').map(Number);
  const hour = h < 8 ? h + 12 : h;
  const [Y, M, D] = d.split('-').map(Number);
  return new Date(Y, M - 1, D, hour, m, 0);
}

const SLOT_MINUTES = 25;

/**
 * Which slot is live right now, purely from the clock. Returns null before the
 * tournament starts or after it ends.
 */
function currentSlot(slots) {
  const now = new Date();
  for (const s of slots) {
    const start = slotDate(s.time);
    if (!start) return null;
    const end = new Date(start.getTime() + SLOT_MINUTES * 60000);
    if (now >= start && now < end) return s.slot;
  }
  return null;
}

/** Group games into slots, preserving order. */
function slotsOf(games) {
  const map = new Map();
  for (const g of games) {
    if (!map.has(g.slot)) map.set(g.slot, { slot: g.slot, time: g.time, phase: g.phase, games: [] });
    map.get(g.slot).games.push(g);
  }
  return [...map.values()].sort((a, b) => a.slot - b.slot);
}

/* --------------------------------------------------------------- status -- */

function renderStatus(slots) {
  const live = currentSlot(slots);
  const node = $('#status-text');
  node.textContent = '';

  const firstUnplayed = store.games.find((g) => g.status !== 'final');
  const done = store.games.every((g) => g.status === 'final');

  if (done) {
    node.append('Tournament complete. ');
    const champ = store.games.find((g) => g.id === 'final');
    if (champ?.status === 'final') {
      const w = champ.scoreA > champ.scoreB ? champ.teamA : champ.teamB;
      const strong = el('strong', null, teamName(w));
      node.append('Champion: ', strong);
    }
    return;
  }

  if (live) {
    const slot = slots.find((s) => s.slot === live);
    node.append('Now playing — ');
    node.append(el('strong', null, `Slot ${live}, ${slot.time}`));
    return;
  }

  if (firstUnplayed) {
    const start = slotDate(firstUnplayed.time);
    const now = new Date();
    if (start && now < start) {
      const days = Math.ceil((start - now) / 86400000);
      node.append(days > 1 ? `Starts in ${days} days — ` : 'Starts ');
      node.append(el('strong', null, `Saturday ${store.tournament?.startTime ?? '10:00'}am`));
      return;
    }
    node.append('Up next — ');
    node.append(el('strong', null, `Slot ${firstUnplayed.slot}, ${firstUnplayed.time}`));
    return;
  }

  node.append('Ready');
}

/* ------------------------------------------------------------ game card -- */

function sideRow(teamId, score, isWinner, fallbackLabel, fresh = false) {
  const row = el('div', 'side');
  if (!teamId) {
    row.classList.add('tbd');
    row.append(fallbackLabel ?? 'To be decided');
    return row;
  }
  if (score != null && !isWinner) row.classList.add('lost');
  row.append(swatch(teamId), el('span', null, teamName(teamId)));
  if (score != null) {
    const s = el('span', `score${fresh ? ' fresh' : ''}`, String(score));
    row.append(s);
  }
  return row;
}

function gameCard(game, { live = false, resolved = null } = {}) {
  const card = el('div', 'court-card');
  if (live && game.status !== 'final') card.classList.add('is-live');
  if (game.status === 'final') card.classList.add('is-done');

  const tagBits = [game.label ?? `Slot ${game.slot}`, `Court ${game.court}`, game.time];
  card.append(el('div', 'court-tag', tagBits.join(' · ')));

  const a = resolved?.sideA ?? { teamId: game.teamA, source: null };
  const b = resolved?.sideB ?? { teamId: game.teamB, source: null };
  const aWins = game.status === 'final' && game.scoreA > game.scoreB;

  // Pop the numbers only the first time we render this result.
  const fresh = game.status === 'final' && !seenFinal.has(`${game.id}:${game.scoreA}-${game.scoreB}`);
  if (game.status === 'final') seenFinal.add(`${game.id}:${game.scoreA}-${game.scoreB}`);

  const wrap = el('div', 'matchup');
  wrap.append(
    sideRow(a.teamId, game.status === 'final' ? game.scoreA : null, aWins, a.source, fresh),
    sideRow(b.teamId, game.status === 'final' ? game.scoreB : null, !aWins, b.source, fresh)
  );
  card.append(wrap);

  if (game.refTeam) {
    const ref = el('div', 'reffed');
    ref.append('Referee: ', el('b', null, teamName(game.refTeam)));
    card.append(ref);
  }
  return card;
}

/* --------------------------------------------------------------- now ----- */

function renderNow(slots) {
  const grid = $('#now-grid');
  grid.textContent = '';

  const live = currentSlot(slots);
  let slot = slots.find((s) => s.slot === live);

  // Before or between slots, show the next one that hasn't been played.
  if (!slot) slot = slots.find((s) => s.games.some((g) => g.status !== 'final'));
  if (!slot) slot = slots[slots.length - 1];
  if (!slot) return;

  const heading = $('#now .section-head p');
  const allDone = store.games.length > 0 && store.games.every((g) => g.status === 'final');

  if (allDone) {
    $('#now .section-head h2').textContent = 'How it finished';
    heading.textContent = 'That\'s a wrap. Same time next year.';
  } else {
    $('#now .section-head h2').textContent = 'On the courts';
    heading.textContent =
      live === slot.slot
        ? 'Playing right now. Whoever isn\'t playing is refereeing.'
        : `Up next — slot ${slot.slot} at ${slot.time}. Two of the teams sitting out are refereeing.`;
  }

  const bracket = currentBracket();
  for (const g of slot.games) {
    const resolved = bracket.games.find((x) => x.id === g.id);
    grid.append(gameCard(g, { live: live === slot.slot, resolved }));
  }
}

/* ---------------------------------------------------------- standings ---- */

function renderStandings() {
  const body = $('#standings-body');
  const rows = computeStandings(store.teams, store.games, store.state.manualTiebreaks);
  flipRows(body, () => renderStandingsRows(body, rows));
  renderTieFlags(rows);
}

function renderStandingsRows(body, rows) {
  body.textContent = '';
  const anyPlayed = store.games.some((g) => g.phase === 'pool' && g.status === 'final');

  // Everyone is technically "tied" at 0-0. Ties only matter once they decide
  // seeding, so don't cry wolf until pool play is actually finished.
  const tiesMatter = poolComplete(store.games);

  for (const r of rows) {
    const tr = el('tr');
    tr.dataset.team = r.id; // FLIP needs a stable identity across rebuilds
    if (anyPlayed && r.rank <= 4) tr.classList.add('seeded-in');

    tr.append(el('td', 'rank', anyPlayed ? String(r.rank) : '–'));

    const teamTd = el('td');
    const cell = el('div', 'team-cell');
    cell.append(swatch(r.id), el('span', null, r.team.name));
    if (tiesMatter && r.tiedWith.length) {
      const flag = el('span', 'chip');
      flag.style.color = 'var(--clay)';
      flag.textContent = 'tied';
      cell.append(flag);
    }
    teamTd.append(cell);
    tr.append(teamTd);

    tr.append(el('td', 'num', String(r.wins)));
    tr.append(el('td', 'num', String(r.losses)));
    tr.append(el('td', 'num', String(r.pointsFor)));
    tr.append(el('td', 'num', String(r.pointsAgainst)));

    const diff = el('td', `num ${r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : ''}`);
    diff.textContent = r.diff > 0 ? `+${r.diff}` : String(r.diff);
    tr.append(diff);

    body.append(tr);
  }
}

// Open ties need a human — say so loudly rather than trusting the order.
function renderTieFlags(rows) {
  const tiesMatter = poolComplete(store.games);
  const flags = $('#tie-flags');
  flags.textContent = '';
  for (const tie of tiesMatter ? unresolvedTies(rows) : []) {
    const box = el('div', 'tie-flag');
    box.append(el('h3', null, 'Dead heat — needs rock paper scissors'));
    box.append(
      el(
        'p',
        null,
        `${tie.ids.map(teamName).join(' and ')} are level on wins, head-to-head, ` +
          'point differential and points scored. Nothing computable separates them, so the ' +
          'captains settle it and Neal records the result before the bracket is set.'
      )
    );
    flags.append(box);
  }
}

/* ------------------------------------------------------------- bracket --- */

function currentBracket() {
  return computeBracket(store.teams, store.games, {
    manualTiebreaks: store.state.manualTiebreaks,
    lockedSeeds: store.state.bracketLocked ? store.state.lockedSeeds : null,
  });
}

/** One side of a bracket match: swatch, name, score. */
function matchSide(side, score, isWinner) {
  const row = el('div', 'match-side');
  if (!side.teamId) {
    row.classList.add('tbd');
    row.append(el('span', 'nm', side.source ?? 'To be decided'));
    return row;
  }
  if (score != null) row.classList.add(isWinner ? 'won' : 'lost');
  row.append(swatch(side.teamId), el('span', 'nm', teamName(side.teamId)));
  row.append(el('span', 's', score == null ? '' : String(score)));
  return row;
}

function matchBox(g) {
  const box = el('div', 'match');
  if (g.status === 'final') box.classList.add('is-done');
  box.append(el('div', 'match-label', `${g.label ?? `Slot ${g.slot}`} · Court ${g.court} · ${g.time}`));
  const aWins = g.status === 'final' && g.scoreA > g.scoreB;
  box.append(
    matchSide(g.sideA, g.status === 'final' ? g.scoreA : null, aWins),
    matchSide(g.sideB, g.status === 'final' ? g.scoreB : null, !aWins)
  );
  return box;
}

/**
 * Connector between bracket columns. Drawn as SVG with a non-scaling stroke so
 * the elbows stay put and the line weight stays constant however the columns
 * stretch. Coordinates assume the feeding column centres its two matches at
 * 25% and 75% of its height, which `justify-content: space-around` guarantees.
 */
function connector(kind) {
  // Mirrors a .round exactly — spacer label, then a stretching area — so the
  // elbows line up with the match boxes instead of being nudged by a margin
  // that guesses the label's height.
  const col = el('div', 'conn-col');
  const spacer = el('div', 'round-label', ' ');
  spacer.setAttribute('aria-hidden', 'true');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'conn');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    kind === 'merge'
      ? 'M0,25 H50 V75 H0 M50,50 H100' // two matches elbow into one
      : 'M0,50 H100'                    // straight run to the trophy
  );
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(path);

  col.append(spacer, svg);
  return col;
}

function renderBracket() {
  const grid = $('#bracket-grid');
  grid.textContent = '';

  const b = currentBracket();
  const byId = (id) => b.games.find((g) => g.id === id);
  const sf1 = byId('sf1');
  const sf2 = byId('sf2');
  const final = byId('final');
  const third = byId('third');

  const note = $('#bracket .section-head p');
  if (b.locked) note.textContent = 'Seeding is locked. Late pool corrections no longer move the bracket.';
  else if (b.seedable) note.textContent = 'Pool play is done and seeding is settled.';
  else if (b.poolComplete && b.unresolvedTies.length) note.textContent = 'Seeding is blocked by a dead heat — see standings.';
  else note.textContent = 'Seeded automatically the moment the last pool game is in.';

  // --- the tree: semis -> final -> champion ---------------------------------
  const tree = el('div', 'bracket-tree');

  const semisCol = el('div', 'round');
  const semisTime = sf1?.time ?? sf2?.time;
  semisCol.append(el('div', 'round-label', semisTime ? `Semifinals · ${semisTime}` : 'Semifinals'));
  const semisMatches = el('div', 'matches');
  if (sf1) semisMatches.append(matchBox(sf1));
  if (sf2) semisMatches.append(matchBox(sf2));
  semisCol.append(semisMatches);

  const finalCol = el('div', 'round');
  finalCol.append(el('div', 'round-label', final?.time ? `Final · ${final.time}` : 'Final'));
  const finalMatches = el('div', 'matches');
  if (final) finalMatches.append(matchBox(final));
  finalCol.append(finalMatches);

  const champCol = el('div', 'round champ-round');
  champCol.append(el('div', 'round-label', 'Champion'));
  const champWrap = el('div', 'matches');

  const champId = final?.status === 'final' ? (final.scoreA > final.scoreB ? final.teamA : final.teamB) : null;
  const champ = el('div', `champion${champId ? '' : ' pending'}`);
  champ.append(el('div', 'trophy', '🏐'));
  if (champId) {
    champ.append(el('div', 'label', 'Champion'));
    champ.append(el('div', 'name', teamName(champId)));
  } else {
    champ.append(el('div', 'label', 'Winner of the final'));
  }
  champWrap.append(champ);
  champCol.append(champWrap);

  tree.append(semisCol, connector('merge'), finalCol, connector('line'), champCol);
  grid.append(tree);

  // --- 3rd place sits outside the tree; it isn't on the path to the title ---
  if (third) {
    const side = el('div', 'third-place');
    side.append(el('div', 'round-label', third.time ? `3rd place · ${third.time}` : '3rd place'));
    side.append(matchBox(third));
    grid.append(side);
  }

  // --- final standings ------------------------------------------------------
  const places = finalPlacings(b).filter((p) => p.teamId);
  if (places.length && final?.status === 'final') {
    const list = el('ol', 'placings');
    for (const p of places) {
      const li = el('li');
      li.append(el('span', 'place', String(p.place)));
      li.append(swatch(p.teamId), el('span', null, teamName(p.teamId)));
      list.append(li);
    }
    grid.append(el('div', 'round-label', 'Final placings'), list);
  }
}

/* --------------------------------------------------------------- teams --- */

function renderTeams() {
  const grid = $('#teams-grid');
  grid.textContent = '';

  const records = computeStandings(store.teams, store.games, store.state.manualTiebreaks);
  const anyPlayed = store.games.some((g) => g.phase === 'pool' && g.status === 'final');

  for (const t of store.teams) {
    const rec = records.find((r) => r.id === t.id);

    const card = el('details', 'team-card');
    // Gradient sits on the card, not the summary, so cards that are shorter
    // than their grid row don't show a dead strip underneath.
    card.style.background = `linear-gradient(135deg, ${t.colorA} 0%, ${t.colorB} 100%)`;

    const sum = el('summary');
    // Light gradients (Tequila Mockingbird's lime/gold) need dark text.
    const ink = inkFor(t);
    sum.style.color = ink.fg;

    sum.append(el('div', 'team-name', t.name));

    const sub = el('div', 'team-sub');
    sub.style.color = ink.sub;
    sub.append(el('span', null, `Captain ${t.captain}`));
    if (anyPlayed && rec) sub.append(el('span', 'chip', `${rec.wins}–${rec.losses}`));
    sum.append(sub);

    // The tagline reads better on the card face than hidden inside the roster.
    if (t.blurb) {
      const tag = el('p', 'team-tagline', t.blurb);
      tag.style.color = ink.sub;
      sum.append(tag);
    }
    card.append(sum);

    const body = el('div', 'team-body');

    const list = el('ul', 'roster');
    for (const p of t.players) {
      const li = el('li');
      if (p === t.captain) li.append(el('span', 'cap', 'C'));
      li.append(el('span', null, p));
      list.append(li);
    }
    for (let i = 0; i < (t.rosterPending ?? 0); i++) {
      const li = el('li');
      li.append(el('span', 'pending', 'player to be confirmed'));
      list.append(li);
    }
    body.append(list);
    card.append(body);
    grid.append(card);
  }
}

/* ------------------------------------------------------------ schedule --- */

function renderSchedule(slots) {
  const body = $('#schedule-body');
  body.textContent = '';
  const live = currentSlot(slots);
  const b = currentBracket();

  for (const s of slots) {
    const tr = el('tr', 'slot-row');
    if (s.slot === live) tr.classList.add('is-live-row');
    if (s.games.every((g) => g.status === 'final')) tr.classList.add('is-done-row');

    tr.append(el('td', 'slot-n', String(s.slot)));
    tr.append(el('td', null, s.time));

    for (const court of [1, 2]) {
      const g = s.games.find((x) => x.court === court);
      const matchTd = el('td', 'match-cell');
      const resultTd = el('td', 'result-cell');

      if (!g) {
        matchTd.textContent = '—';
        resultTd.textContent = '';
      } else {
        const r = b.games.find((x) => x.id === g.id);
        const aName = r?.sideA.teamId ? teamName(r.sideA.teamId) : r?.sideA.source ?? teamName(g.teamA);
        const bName = r?.sideB.teamId ? teamName(r.sideB.teamId) : r?.sideB.source ?? teamName(g.teamB);
        const aWins = g.status === 'final' && g.scoreA > g.scoreB;

        // Winner in bold so the Result column's two numbers map to the names.
        matchTd.append(
          el(g.status === 'final' && aWins ? 'b' : 'span', null, aName),
          el('span', 'vs', ' v '),
          el(g.status === 'final' && !aWins ? 'b' : 'span', null, bName)
        );
        if (g.refTeam && g.status !== 'final') {
          matchTd.append(el('div', 'ref-line', `ref: ${teamName(g.refTeam)}`));
        }

        if (g.status === 'final') {
          resultTd.append(el('span', aWins ? 'won' : 'lost', String(g.scoreA)));
          resultTd.append(el('span', 'dash', '–'));
          resultTd.append(el('span', aWins ? 'lost' : 'won', String(g.scoreB)));
        } else {
          resultTd.append(el('span', 'pending', '—'));
        }
      }
      tr.append(matchTd, resultTd);
    }
    body.append(tr);
  }
}

/* ----------------------------------------------------------------- run --- */

function renderAll() {
  const slots = slotsOf(store.games);
  renderStatus(slots);
  renderNow(slots);
  renderStandings();
  renderBracket();
  renderTeams();
  renderSchedule(slots);
}

async function refresh() {
  try {
    const data = await fetchAll();
    store.teams = data.teams;
    store.games = data.games;
    store.state = data.state;
    store.tournament = data.tournament;
    store.offline = data.offline;
    store.byId = new Map(data.teams.map((t) => [t.id, t]));
    $('#offline').hidden = !data.offline;
    renderAll();
  } catch (err) {
    console.error('Refresh failed', err);
    $('#offline').hidden = false;
  }
}

store.refresh = refresh;

await refresh();
mountAdmin(store);
mountReveal();

setInterval(refresh, POLL_MS);
// The live/next slot changes with the clock, not just with the data.
setInterval(() => renderAll(), 30000);

// Refresh immediately when someone returns to the tab.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});
