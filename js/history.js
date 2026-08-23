/**
 * The history page — every tournament we've ever run.
 *
 * Reads only the frozen JSON in data/history/. No Supabase, no polling: the
 * live tables hold one tournament at a time and get wiped for the next one, so
 * anything that has to survive lives on disk. That also means this page still
 * works when the database is empty, paused, or gone.
 *
 * data/history/index.json carries just enough for the banners (champion, date,
 * colours, roster). The full record for a tournament is fetched only when its
 * banner is tapped, so a page with twenty banners still loads one small file.
 */

const INDEX_URL = 'data/history/index.json';
const recordUrl = (slug) => `data/history/${slug}.json`;

const $ = (sel) => document.querySelector(sel);

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const DOT = ' · ';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

const ordinal = (n) => ['', '1st', '2nd', '3rd'][n] ?? `${n}th`;

/** Parsed by hand rather than with Date — "2026-08-22" parses as UTC and can
 *  render as the 21st for anyone west of Greenwich, which is everyone here. */
const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const shortDate = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
};

/** Bracket game id → what to call that round. */
const STAGE = { qf1: 'Quarterfinal', qf2: 'Quarterfinal', qf3: 'Quarterfinal', qf4: 'Quarterfinal',
                sf1: 'Semifinal', sf2: 'Semifinal', third: '3rd place', final: 'Final' };

const records = new Map();   // slug -> full record, fetched once

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/* ------------------------------------------------------------- banners -- */

/** Two empty slots after the last champion, so the wall reads as unfinished. */
const GHOSTS = [{ label: 'Next one', hint: 'Not scheduled' }, { label: 'And after', hint: '' }];

function renderBanners(tournaments) {
  const wall = $('#banners');

  wall.innerHTML =
    tournaments.map((t, i) => `
      <button class="banner" type="button" role="tab" data-slug="${esc(t.slug)}"
              style="--i:${i}" aria-selected="${i === 0}" aria-pressed="${i === 0}">
        <span class="tie" aria-hidden="true"><i></i><i></i></span>
        <span class="cloth" style="background-color:${esc(t.champion.colorA)}">
          <span class="b-eyebrow">Champions</span>
          <span class="b-date">${esc(shortDate(t.date))}${DOT}${esc(t.date.slice(0, 4))}</span>
          <span class="b-name">${esc(t.champion.name)}</span>
          <span class="b-roster">${t.champion.players.map(esc).join('<br>')}</span>
        </span>
      </button>`).join('') +
    GHOSTS.map((g, gi) => `
      <span class="banner ghost" style="--i:${tournaments.length + gi}" aria-hidden="true">
        <span class="tie"><i></i><i></i></span>
        <span class="cloth">
          <span class="b-eyebrow">${esc(g.label)}</span>
          ${g.hint ? `<strong>${esc(g.hint)}</strong>` : ''}
        </span>
      </span>`).join('');

  wall.addEventListener('click', (e) => {
    const b = e.target.closest('.banner');
    if (!b || b.classList.contains('ghost')) return;
    select(b.dataset.slug);
  });
}

function markSelected(slug) {
  for (const b of document.querySelectorAll('.banner[data-slug]')) {
    const on = b.dataset.slug === slug;
    b.setAttribute('aria-selected', String(on));
    b.setAttribute('aria-pressed', String(on));
  }
}

/* -------------------------------------------------------------- record -- */

function renderRecord(t) {
  const bracket = t.games.filter((g) => g.phase === 'bracket' && g.status === 'final');

  $('#detail').innerHTML = `
    <div class="detail-head">
      <h2>${esc(fmtDate(t.date))}</h2>
      <span class="when">${esc(t.venue ?? '')}${DOT}${t.teams.length} teams${DOT}${t.games.length} games</span>
    </div>

    <div class="cols">
      <div class="block">
        <h3>Where everyone finished</h3>
        <div class="podium">
          ${t.podium.map((p) => `
            <div class="place ${p.place === 1 ? 'gold' : ''}" style="--swatch:${esc(p.colorA)}">
              <span class="place-rank">${p.place}</span>
              <span class="who">
                <span class="team">${esc(p.name)}</span>
                <span class="roster">${p.players.map(esc).join(DOT)}</span>
              </span>
              <span class="score">${esc(p.note)}</span>
            </div>`).join('')}
        </div>

        <h3>How the bracket went</h3>
        <div class="path">
          ${bracket.map((g) => {
            const aWon = g.winner === g.teamA;
            const won = aWon ? g.teamAName : g.teamBName;
            const lost = aWon ? g.teamBName : g.teamAName;
            // A game nobody played gets a word, not an invented scoreline.
            const result = g.forfeitBy
              ? `<span class="conceded">${esc(g.forfeitByName)} conceded</span>`
              : `<span class="final-score">${Math.max(g.scoreA, g.scoreB)}–${Math.min(g.scoreA, g.scoreB)}</span>`;
            return `
              <div class="leg ${g.id === 'final' ? 'decider' : ''}">
                <span class="stage">${esc(STAGE[g.id] ?? g.label ?? '')}</span>
                <span class="matchup"><span class="w">${esc(won)}</span>
                  <span class="l">over ${esc(lost)}</span></span>
                ${result}
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="block">
        <h3>Pool play, final</h3>
        <div class="table-scroll">
          <table>
            <thead><tr>
              <th scope="col">#</th><th scope="col">Team</th>
              <th scope="col">W</th><th scope="col">L</th>
              <th scope="col">PF</th><th scope="col">PA</th><th scope="col">Diff</th>
            </tr></thead>
            <tbody>
              ${t.pool.map((r) => `
                <tr class="${r.qualified ? 'qualified' : ''}">
                  <td class="pos">${r.pos}</td>
                  <td><span class="swatch" style="background:${esc(r.colorA)}"></span>${esc(r.name)}</td>
                  <td>${r.wins}</td><td>${r.losses}</td>
                  <td>${r.pointsFor}</td><td>${r.pointsAgainst}</td>
                  <td>${r.diff > 0 ? '+' : ''}${r.diff}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="pos-note">Top four made the bracket. Bold rows qualified.</p>
      </div>
    </div>`;
}

function renderTeams(t) {
  // Order by where teams actually finished. `placings` covers the whole field;
  // older archives only stored the podium, so fall back to the pool table.
  const finish = new Map((t.placings ?? t.podium).map((p) => [p.teamId, p.place]));
  const poolPos = new Map(t.pool.map((r) => [r.teamId, r.pos]));
  const rank = (id) => finish.get(id) ?? 99;

  const ordered = [...t.teams].sort(
    (a, b) => rank(a.id) - rank(b.id) || (poolPos.get(a.id) ?? 99) - (poolPos.get(b.id) ?? 99));

  $('#past-teams').innerHTML = `
    <p class="eyebrow">Who played</p>
    <h2>The ${t.teams.length} teams</h2>
    <div class="past-team-grid">
      ${ordered.map((team) => {
        const place = finish.get(team.id);
        const where = place ? `${ordinal(place)} overall`
                            : `${ordinal(poolPos.get(team.id))} in pool`;
        return `
          <div class="past-team ${place === 1 ? 'champ' : ''}" style="--swatch:${esc(team.colorA)}">
            <div class="tname">${esc(team.name)}</div>
            <div class="tfinish">${esc(where)}</div>
            <ul>${team.players.map((p) => `
              <li class="${p === team.captain ? 'cap' : ''}">${esc(p)}</li>`).join('')}</ul>
          </div>`;
      }).join('')}
    </div>`;
}

/* --------------------------------------------------------------- wiring -- */

async function select(slug) {
  markSelected(slug);
  try {
    if (!records.has(slug)) records.set(slug, await getJSON(recordUrl(slug)));
    const t = records.get(slug);
    renderRecord(t);
    renderTeams(t);
  } catch (err) {
    $('#detail').innerHTML =
      `<p class="empty">That tournament's record didn't load. Refresh, or check back on signal.</p>`;
    $('#past-teams').innerHTML = '';
    console.warn(`Could not load ${slug}:`, err.message);
  }
}

async function main() {
  let index;
  try {
    index = await getJSON(INDEX_URL);
  } catch (err) {
    console.warn('History index unavailable:', err.message);
    $('#detail').innerHTML = `<p class="empty">The history didn't load. Refresh to try again.</p>`;
    return;
  }

  const tournaments = index.tournaments ?? [];
  if (!tournaments.length) {
    $('#detail').innerHTML =
      `<p class="empty">No tournaments archived yet. The first champion goes up here.</p>`;
    return;
  }

  renderBanners(tournaments);
  await select(tournaments[0].slug);
}

main();
