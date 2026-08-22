# 2026 Grass Volleyball

First (hopefully annual) grass volleyball tournament in Chicago.

**Saturday, August 22, 2026 · 10:00am · [AIDS Garden Chicago](https://maps.app.goo.gl/3XGj2SXXnHnxGyKL7)**

### → [grass-volleyball-2026.netlify.app](https://grass-volleyball-2026.netlify.app)

Live standings, bracket and schedule. Send this link to the captains.

7 teams · 2 courts · every team plays 5–6 games · done by ~2:10pm

> **If it rains, it's cancelled.** Captains get a text by 8:00am.

---

## For players

| | |
|:--|:--|
| **[Schedule](docs/SCHEDULE.md)** | Who you play, when, and which slots you referee |
| **[Rules](docs/RULES.md)** | Adapted from the Montrose Classic for grass |
| **[Format](docs/FORMAT.md)** | How pool play and the bracket work |
| **[Logistics](docs/LOGISTICS.md)** | Parking, nets, what to bring |

**Day-of TL;DR**

- Be there **9:30** if you're on net setup, **10:00** to play.
- Pool games to **21**, win by 2, cap 23. Bracket games to **25**.
- **At least one woman on the court per team, at all times.** Applies when you're playing with 3 too.
- **When you're not playing, you're usually refereeing.** Two ref slots each, plus one slot fully off.
- Enter **both scores** after every game — point differential decides bracket seeding.
- Bring water. There's no shade on the courts.

---

## The teams

| Seed | Team | Captain | Net |
|:--|:--|:--|:--:|
| 1 | Deez Nets | Michael Keo | ✅ |
| 2 | Haikyuties | Janna Remperas | |
| 3 | Tequila Mockingbird | Grant McLean | ✅ |
| 4 | Cinnamon Rolls | Neal Matta | |
| 5 | Perros Calientes | Alfonso | |
| 6 | Bumping Buds | Jamie Kolar | |
| 7 | Cerve Aces | Luke | |

Seeds are signup order — they're just schedule IDs. Real seeding comes from pool record.

---

## Format in one paragraph

Seven teams, two courts, a bit over four hours. Pool play is a **near round robin** — each team
plays 4 of the 6 others across 7 slots, and in every slot two of the three teams that aren't
playing referee. Then the top four seeds go to a **single-elimination bracket** (#1v#4, #2v#3),
with a 3rd-place game so a semifinal loss doesn't end your day. Nobody is eliminated before the
bracket.

The schedule also guarantees a rhythm: **never more than two games in a row, never two slots off in
a row, never two ref slots in a row.** Nobody sits around for half the morning and then plays four
straight.

Montrose runs Tiered Swiss; we don't, because Swiss exists to approximate a round robin when you
have too many teams to play everyone — and with seven teams you can still get most of the way there
by just playing.
Details and the reasoning in [FORMAT.md](docs/FORMAT.md).

---

## Entering scores on the day

No login, no passcode. Anyone can post a result.

1. Open the site, tap **Enter a score**
2. Tap the game you just finished
3. Enter **both** scores, submit
4. Standings and the bracket update for everyone within 15 seconds

The bracket seeds itself the moment the 14th pool score lands. If two teams finish dead level on
wins, head-to-head, differential *and* points scored, the site says so and asks you to pick the
winner rather than guessing. Once the semis start, hit **Lock seeding** so a late correction can't
reshuffle a game already in progress.

Mistyped a score? Tap the finished game and fix it. Everything here is reversible, which is what
makes leaving the door open reasonable — a wrong number is a ten-second correction rather than
something anyone has to go find the organiser about.

The trade-off, stated plainly: the site is public, so this trusts everyone who has the URL, not
only the people at the park. To put a passcode back, set an `ADMIN_PASSCODE` secret and reinstate
the check marked in `supabase/functions/submit-score/index.ts`.

## Development

Plain HTML/CSS/JS, no framework. Supabase for live scores, Netlify for hosting.

```bash
npm run verify    # schedule invariants + standings/bracket unit tests
npm run gen       # regenerate docs/SCHEDULE.md and supabase/seed.sql from data/
npm run build     # assemble dist/
npm run deploy    # build + push to Netlify

npm run dry-run   # play a full tournament through the live API, verify, reset
npm run reset     # clear all scores
```

**`npm run verify` after any schedule edit.** `verify-schedule.mjs` asserts every team plays
exactly 4, referees exactly 2, appears once per slot, and that no pairing repeats — plus the three
rhythm invariants (no 3 games in a row, no 2 rests in a row, no 2 ref slots in a row). It exists
because a hand-written version of the schedule table was wrong once already — Deez Nets had three
games instead of four.

`data/schedule.json` is the single source of truth. `docs/SCHEDULE.md`, `docs/scoresheet.md` and
`supabase/seed.sql` are **generated** from it — edit the JSON and regenerate, don't hand-edit those.

### Privacy

**This repo is public and so is the site.** Player emails and phone numbers are never committed,
never stored in the database, and never shipped to the browser. Three independent guards:

1. `data/raw/` (the signup CSV) is gitignored
2. `scripts/build-site.mjs` builds `dist/` from an **allowlist**, so a stray `--dir .` deploy can't
   publish the CSV, and it hard-fails if anything matching `raw/`, `.csv` or `.env` appears
3. `data/teams.json` and the `teams` table hold names only — there is no contact column to leak

### Security

The Supabase anon key is in `js/data.js` on purpose — it's public by design and only grants the
read-only access RLS allows. Verified: with that key alone, UPDATE, INSERT and DELETE against
`games`, `teams` and `tournament_state` all fail to change anything.

Score submission is deliberately open — see "Entering scores on the day" above. That's a choice
about who can write, not a hole in the setup: the browser still cannot touch the tables directly.
Every write goes through the `submit-score` edge function, which validates scores (whole numbers,
in range, no ties) and refuses bracket games until both teams are actually known, then writes with
the service role key that never leaves the server.

### Layout

```
data/teams.json          rosters — names only
data/schedule.json       the 9 slots, source of truth
data/raw/                gitignored — raw signup CSV
scripts/                 schedule verification, doc generation, dry run
docs/                    format, rules, schedule, logistics, paper scoresheet
supabase/                schema, RLS policies, score submission function
```
