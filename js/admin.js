/**
 * Admin panel — passcode, score entry, corrections, bracket lock.
 *
 * The passcode is only ever held in this device's localStorage and sent to the
 * edge function for verification. It is never in the source, and the anon key
 * on its own cannot write anything.
 */

import { submitScore, reopenGame, updateState, checkPasscode } from './data.js';
import { computeStandings, unresolvedTies, tieKey } from './standings.js';
import { computeBracket } from './bracket.js';

const PASS_KEY = 'gv2026.passcode';
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export function mountAdmin(store) {
  const dialog = document.getElementById('admin-dialog');
  const body = document.getElementById('admin-body');
  const title = document.getElementById('admin-title');

  let passcode = localStorage.getItem(PASS_KEY) ?? '';
  let view = { name: 'list', gameId: null };

  const teamName = (id) => store.teams.find((t) => t.id === id)?.name ?? '—';

  const say = (text, kind = '') => {
    const m = el('div', `msg ${kind}`.trim(), text);
    body.prepend(m);
    if (kind === 'ok') setTimeout(() => m.remove(), 4000);
  };

  /* ------------------------------------------------------------ passcode -- */

  function renderPasscode(message) {
    title.textContent = 'Captain access';
    body.textContent = '';

    if (message) say(message, 'error');

    body.append(
      el('p', null, 'Neal shares one passcode with all six captains. Enter it once — this device will remember it for the day.')
    );

    const label = el('label', null, 'Passcode');
    const input = el('input');
    input.type = 'password';
    input.autocomplete = 'off';
    input.setAttribute('inputmode', 'text');
    label.append(input);

    const go = el('button', 'btn', 'Unlock');
    go.type = 'button';

    const submit = async () => {
      const value = input.value.trim();
      if (!value) return;
      go.disabled = true;
      go.textContent = 'Checking…';
      const ok = await checkPasscode(value).catch(() => false);
      go.disabled = false;
      go.textContent = 'Unlock';
      if (!ok) return renderPasscode('That passcode didn\'t work. Ask Neal.');
      passcode = value;
      localStorage.setItem(PASS_KEY, value);
      render();
    };

    go.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });

    body.append(label, go);
    setTimeout(() => input.focus(), 50);
  }

  /* --------------------------------------------------------- game picker -- */

  function renderList() {
    title.textContent = 'Enter a score';
    body.textContent = '';

    const bracket = computeBracket(store.teams, store.games, {
      manualTiebreaks: store.state.manualTiebreaks,
      lockedSeeds: store.state.bracketLocked ? store.state.lockedSeeds : null,
    });

    const resolvedOf = (g) => bracket.games.find((x) => x.id === g.id);

    const label = (g) => {
      const r = resolvedOf(g);
      const a = r ? (r.sideA.teamId ? teamName(r.sideA.teamId) : r.sideA.source) : teamName(g.teamA);
      const b = r ? (r.sideB.teamId ? teamName(r.sideB.teamId) : r.sideB.source) : teamName(g.teamB);
      return `${a} v ${b}`;
    };

    const playable = (g) => {
      if (g.phase === 'pool') return true;
      const r = resolvedOf(g);
      return Boolean(r?.ready);
    };

    // Unplayed games first, in schedule order — the next one to score is at the top.
    const pending = store.games.filter((g) => g.status !== 'final');
    const done = store.games.filter((g) => g.status === 'final');

    if (pending.length) {
      body.append(el('p', null, 'Tap the game you just finished.'));
      const picker = el('div', 'game-picker');
      pending.forEach((g, i) => {
        const btn = el('button', `game-option${i === 0 ? ' next' : ''}`);
        btn.type = 'button';
        const col = el('div');
        col.append(el('div', 'when', `${g.label ?? `Slot ${g.slot}`} · ${g.time} · Court ${g.court}`));
        col.append(el('div', 'who', label(g)));
        btn.append(col);
        if (!playable(g)) {
          btn.disabled = true;
          btn.append(el('span', 'done', 'waiting'));
        }
        btn.addEventListener('click', () => { view = { name: 'score', gameId: g.id }; render(); });
        picker.append(btn);
      });
      body.append(picker);
    } else {
      body.append(el('p', null, 'Every game has a score. Nice work.'));
    }

    if (done.length) {
      const h = el('p', null, 'Made a mistake? Tap a finished game to fix it.');
      h.style.marginTop = '1rem';
      body.append(h);
      const picker = el('div', 'game-picker');
      for (const g of done) {
        const btn = el('button', 'game-option');
        btn.type = 'button';
        const col = el('div');
        col.append(el('div', 'when', `${g.label ?? `Slot ${g.slot}`} · ${g.time} · Court ${g.court}`));
        col.append(el('div', 'who', label(g)));
        btn.append(col);
        btn.append(el('span', 'done', `${g.scoreA}–${g.scoreB}`));
        btn.addEventListener('click', () => { view = { name: 'score', gameId: g.id }; render(); });
        picker.append(btn);
      }
      body.append(picker);
    }

    renderTieTools(bracket);
    renderLockTools(bracket);
  }

  /* ---------------------------------------------------------- score form -- */

  function renderScore(gameId) {
    const game = store.games.find((g) => g.id === gameId);
    if (!game) { view = { name: 'list' }; return render(); }

    const bracket = computeBracket(store.teams, store.games, {
      manualTiebreaks: store.state.manualTiebreaks,
      lockedSeeds: store.state.bracketLocked ? store.state.lockedSeeds : null,
    });
    const r = bracket.games.find((x) => x.id === gameId);
    const aId = r?.sideA.teamId ?? game.teamA;
    const bId = r?.sideB.teamId ?? game.teamB;

    title.textContent = game.label ?? `Slot ${game.slot} · Court ${game.court}`;
    body.textContent = '';

    const back = el('button', 'btn ghost', '← All games');
    back.type = 'button';
    back.addEventListener('click', () => { view = { name: 'list' }; render(); });
    body.append(back);

    const cap = game.phase === 'pool' ? 23 : 27;
    const target = game.phase === 'pool' ? 21 : 25;
    body.append(el('p', null, `To ${target}, win by 2, cap ${cap}. If time ran out, enter the score as it stood.`));

    const pair = el('div', 'score-pair');

    const mk = (id, value) => {
      const label = el('label', null, teamName(id));
      const input = el('input');
      input.type = 'number';
      input.min = '0';
      input.max = '99';
      input.inputMode = 'numeric';
      if (value != null) input.value = String(value);
      label.append(input);
      return { label, input };
    };

    const A = mk(aId, game.scoreA);
    const B = mk(bId, game.scoreB);

    pair.append(A.label, el('div', 'vs', 'v'), B.label);
    body.append(pair);

    const save = el('button', 'btn', game.status === 'final' ? 'Update score' : 'Submit score');
    save.type = 'button';
    save.addEventListener('click', async () => {
      const scoreA = Number(A.input.value);
      const scoreB = Number(B.input.value);

      if (A.input.value === '' || B.input.value === '') return say('Enter both scores.', 'error');
      if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) return say('Whole numbers only.', 'error');
      if (scoreA === scoreB) return say('Volleyball has no ties — one team has to win.', 'error');

      save.disabled = true;
      save.textContent = 'Saving…';
      try {
        await submitScore({ gameId, scoreA, scoreB, passcode });
        await store.refresh();
        view = { name: 'list' };
        render();
        say(`Saved: ${teamName(aId)} ${scoreA}–${scoreB} ${teamName(bId)}`, 'ok');
      } catch (err) {
        save.disabled = false;
        save.textContent = 'Submit score';
        if (/passcode/i.test(err.message)) return renderPasscode(err.message);
        say(err.message, 'error');
      }
    });
    body.append(save);

    if (game.status === 'final') {
      const clear = el('button', 'btn ghost', 'Clear this result');
      clear.type = 'button';
      clear.addEventListener('click', async () => {
        clear.disabled = true;
        try {
          await reopenGame({ gameId, passcode });
          await store.refresh();
          view = { name: 'list' };
          render();
          say('Result cleared.', 'ok');
        } catch (err) {
          clear.disabled = false;
          say(err.message, 'error');
        }
      });
      body.append(clear);
    }
  }

  /* ----------------------------------------------------------- tie tools -- */

  function renderTieTools(bracket) {
    // Before pool play ends every team is level at 0-0; that isn't a dead heat.
    if (!bracket.poolComplete) return;

    const rows = computeStandings(store.teams, store.games, store.state.manualTiebreaks);
    const ties = unresolvedTies(rows);
    if (!ties.length) return;

    const box = el('div', 'tie-flag');
    box.append(el('h3', null, 'Dead heat — pick the winner'));
    box.append(el('p', null, 'These teams are level on everything the site can compute. Play rock paper scissors, then record it.'));

    for (const tie of ties) {
      const wrap = el('div');
      wrap.style.marginTop = '.75rem';
      wrap.append(el('div', 'who', tie.ids.map(teamName).join(' v ')));

      for (const winner of tie.ids) {
        const btn = el('button', 'btn ghost', `${teamName(winner)} ranks higher`);
        btn.type = 'button';
        btn.style.marginTop = '.35rem';
        btn.addEventListener('click', async () => {
          const order = [winner, ...tie.ids.filter((x) => x !== winner)];
          const next = { ...store.state.manualTiebreaks, [tieKey(tie.ids)]: order };
          btn.disabled = true;
          try {
            await updateState({ passcode, manualTiebreaks: next });
            await store.refresh();
            render();
            say('Tiebreak recorded.', 'ok');
          } catch (err) {
            btn.disabled = false;
            say(err.message, 'error');
          }
        });
        wrap.append(btn);
      }
      box.append(wrap);
    }
    body.append(box);
  }

  /* ---------------------------------------------------------- lock tools -- */

  function renderLockTools(bracket) {
    const wrap = el('div');
    wrap.style.marginTop = '1.25rem';
    wrap.style.borderTop = '2px solid var(--turf-line)';
    wrap.style.paddingTop = '1rem';

    if (store.state.bracketLocked) {
      wrap.append(el('p', null, 'Seeding is locked. Pool corrections no longer move the bracket.'));
      const unlock = el('button', 'btn ghost', 'Unlock seeding');
      unlock.type = 'button';
      unlock.addEventListener('click', async () => {
        unlock.disabled = true;
        try {
          await updateState({ passcode, bracketLocked: false, lockedSeeds: null });
          await store.refresh();
          render();
        } catch (err) { unlock.disabled = false; say(err.message, 'error'); }
      });
      wrap.append(unlock);
      body.append(wrap);
      return;
    }

    if (!bracket.seedable) {
      wrap.append(
        el('p', null,
          bracket.unresolvedTies.length
            ? 'Settle the dead heat above before locking the bracket.'
            : 'Lock seeding once every pool game has a score.')
      );
      body.append(wrap);
      return;
    }

    wrap.append(el('p', null, `Seeds: ${bracket.seeds.map((id, i) => `${i + 1}. ${teamName(id)}`).join('  ')}`));
    const lock = el('button', 'btn', 'Lock seeding & start the bracket');
    lock.type = 'button';
    lock.addEventListener('click', async () => {
      lock.disabled = true;
      try {
        await updateState({ passcode, bracketLocked: true, lockedSeeds: bracket.seeds });
        await store.refresh();
        render();
        say('Bracket locked.', 'ok');
      } catch (err) { lock.disabled = false; say(err.message, 'error'); }
    });
    wrap.append(lock);
    body.append(wrap);
  }

  /* ------------------------------------------------------------- render -- */

  function render() {
    if (!passcode) return renderPasscode();
    if (view.name === 'score') return renderScore(view.gameId);
    return renderList();
  }

  document.getElementById('admin-open').addEventListener('click', () => {
    view = { name: 'list' };
    render();
    dialog.showModal();
  });

  dialog.addEventListener('close', () => { view = { name: 'list' }; });
}
