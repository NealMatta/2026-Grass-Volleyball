# Running the next one

A checklist to follow cold, months later, having forgotten all of it.

The site is reused for every tournament. The live Supabase tables only ever hold **one**
tournament — the current one — so the first step is always to save the last one before
anything overwrites it.

---

## 0. Before you touch anything: archive the last tournament

```bash
npm run archive
```

Reads the finished tournament out of Supabase and writes it to
`data/history/<date>-<slug>.json`, then rebuilds `data/history/index.json`.

**Commit that file.** Once you reset the tables it is the only copy that exists.

The script refuses to run if any game is still unscored, so you can't accidentally
freeze a half-finished tournament. If a game genuinely never got played, record the
concession first (see *Forfeits* below) rather than passing `--force`.

Check the output — it prints the champion, the podium and the final pool order. If that
doesn't match what happened, fix it in the app **before** archiving, not afterwards.

---

## 1. Clear the live scores

```bash
npm run reset
```

Blanks every score and sets every game back to `scheduled`. Teams and the schedule stay.

---

## 2. Put the new tournament in

Two files, both hand-edited. There is no generator and no admin page — this is on purpose:
it's a handful of teams a few times a year, and editing JSON is faster than building a
form to edit JSON.

### `data/teams.json`

One entry per team. **Names only — never an email or a phone number.** This repo is
public and this file ships to the browser.

```json
{
  "id": "deez-nets",              // lowercase, hyphenated, used everywhere else
  "name": "Deez Nets",
  "seed": 1,                       // signup order, NOT a ranking
  "captain": "Michael Keo",
  "players": ["Michael Keo", "Cynthia", "Kevin", "Nick"],
  "hasNet": true,
  "colorA": "#2D3561",             // the two colours the team is drawn in
  "colorB": "#5B6BC0",
  "blurb": "Bringing a net and the pun. Both essential."
}
```

### `data/schedule.json`

The `tournament` block first:

```json
"name":   "Neal's Grass Volleyball Tournament",
"slug":   "grass-volleyball",     // archive filenames: <date>-<slug>.json
"status": "scheduled",            // "none" between tournaments — see step 6
"date":   "2026-09-19",
"dayOfWeek": "Saturday",
"startTime": "10:00",
"venue":  "AIDS Garden Chicago",
"mapUrl": "https://maps.app.goo.gl/...",
"courts": 2
```

Then the slots. Each pool slot lists the games on each court:

```json
{ "slot": 1, "time": "10:00", "phase": "pool", "games": [
  { "id": "p1", "court": 1, "a": "cinnamon-rolls", "b": "cerve-aces" },
  { "id": "p2", "court": 2, "a": "perros-calientes", "b": "bumping-buds" }
]}
```

Bracket slots reference positions rather than teams, and resolve themselves:

```json
{ "slot": 8, "time": "1:05", "phase": "bracket", "games": [
  { "id": "sf1", "court": 1, "label": "Semifinal 1", "a": { "seed": 1 }, "b": { "seed": 4 } },
  { "id": "sf2", "court": 2, "label": "Semifinal 2", "a": { "seed": 2 }, "b": { "seed": 3 } }
]}
```

Keep the game ids (`p1`, `sf1`, `final`, `third`) — other things key off them.

---

## 3. Check it

```bash
npm run verify
```

Asserts every team plays the same number of games, no pairing repeats, nobody is in two
places in one slot, and the rhythm rules hold (never three games in a row, never two
slots off in a row).

**Do not skip this.** A hand-written schedule was wrong once already — Deez Nets had
three pool games instead of four, and nobody noticed until this check existed.

---

## 4. Regenerate and reseed

```bash
npm run gen
```

Rewrites `docs/SCHEDULE.md`, `docs/scoresheet.md` and `supabase/seed.sql` from the data
files. Don't hand-edit those three — they're outputs.

Then apply `supabase/seed.sql` to the database (Supabase dashboard → SQL editor, or
`supabase db push`). That replaces the teams and games with the new tournament.

---

## 5. Ship it

```bash
npm run deploy
```

Builds `dist/` from an allowlist and pushes to Netlify. Same URL every time.

Send the link to the captains.

---

## 6. Afterwards

When the tournament is over and archived (back to step 0), set the tournament block's
`status` to `"none"` and deploy again. The homepage then shows the "to be scheduled"
placeholder instead of a stale schedule, skips the database entirely, and points people
at the history page.

Leave it that way until the next date is real.

---

## Forfeits

Some games don't get played — a team doesn't show, or is done for the day and concedes.

In the score panel, open the game and use **Not played?** → *«Team» conceded*.

This stores a nominal 1–0 so standings still resolve a winner, and flags the game so the
site shows **Conceded** rather than a scoreline nobody earned. The 1–0 is deliberate: it
decides the game without a match that never happened moving anyone's point differential.

Entering real scores on that game afterwards clears the flag.

---

## Things that will bite you

- **Archive before reset.** `npm run reset` is not reversible and the tables are the only
  live copy. This is why step 0 is step 0.
- **`data/raw/` is gitignored** and the build refuses to publish anything matching
  `raw/`, `.csv` or `.env`. Keep the signup spreadsheet there and nowhere else.
- **`data/schedule.json` is the source of truth.** `docs/SCHEDULE.md`, the scoresheet and
  `supabase/seed.sql` are generated from it.
- **Editing `js/standings.js` means re-copying it**:
  `cp js/standings.js supabase/functions/_shared/standings.js`, then redeploy the
  `submit-score` function. The browser and the server have to agree on seeding exactly,
  or the bracket the phone shows isn't the one the server will accept a score for.
