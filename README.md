# 2026 Grass Volleyball

First (hopefully annual) grass volleyball tournament in Chicago.

**Saturday, August 22, 2026 · 10:00am · [AIDS Garden Chicago](https://maps.app.goo.gl/3XGj2SXXnHnxGyKL7)**

### → [grass-volleyball-2026.netlify.app](https://grass-volleyball-2026.netlify.app)

Live standings, bracket and schedule. Send this link to the captains.

6 teams · 2 courts · every team plays 5–6 games · done by ~1:45pm

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

- Be there **9:30** if you're on net setup, **10:00** to play. 5 minutes late = forfeit.
- Pool games to **21**, hard 21-minute cap. **At time, whoever leads wins.**
- **When you're not playing, you're refereeing.** Two slots each.
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

Seeds are signup order — they're just schedule IDs. Real seeding comes from pool record.

---

## Format in one paragraph

Six teams, two courts, four hours. Pool play is a **near round robin** — each team plays 4 of the 5
others across 6 slots, and in every slot the two teams that aren't playing referee. Then the top
four seeds go to a **single-elimination bracket** (#1v#4, #2v#3), with a 3rd-place game so a
semifinal loss doesn't end your day. Nobody is eliminated before the bracket.

Montrose runs Tiered Swiss; we don't, because Swiss exists to approximate a round robin when you
have too many teams to play everyone — and with six teams you can nearly just play everyone.
Details and the reasoning in [FORMAT.md](docs/FORMAT.md).

---

## Entering scores on the day

Share **one passcode** with all six captains. Anyone with it can post a score.

1. Open the site, tap **Enter a score**
2. Type the passcode once — that device remembers it for the day
3. Tap the game you just finished, enter **both** scores, submit
4. Standings and the bracket update for everyone within 15 seconds

The bracket seeds itself the moment the 12th pool score lands. If two teams finish dead level on
wins, head-to-head, differential *and* points scored, the site says so and asks you to pick the
winner rather than guessing. Once the semis start, hit **Lock seeding** so a late correction can't
reshuffle a game already in progress.

Mistyped a score? Tap the finished game and fix it.

To change the passcode:

```bash
supabase secrets set ADMIN_PASSCODE=<new-code>
supabase functions deploy submit-score --no-verify-jwt
```

## Development

Plain HTML/CSS/JS, no framework. Supabase for live scores, Netlify for hosting.

```bash
npm run verify    # schedule invariants + standings/bracket unit tests
npm run gen       # regenerate docs/SCHEDULE.md and supabase/seed.sql from data/
npm run build     # assemble dist/
npm run deploy    # build + push to Netlify

npm run dry-run -- --passcode <code>   # play a full tournament, verify, reset
npm run reset -- --passcode <code>     # clear all scores
```

**`npm run verify` after any schedule edit.** `verify-schedule.mjs` asserts every team plays
exactly 4, referees exactly 2, appears once per slot, and that no pairing repeats. It exists
because a hand-written version of the schedule table was wrong once already — Deez Nets had three
games instead of four.

`docs/SCHEDULE.md` and `supabase/seed.sql` are **generated**. Edit `data/schedule.json` and
regenerate; don't hand-edit them.

`data/schedule.json` is the single source of truth for the schedule. `verify-schedule.mjs` asserts
that every team plays exactly 4, referees exactly 2, appears at most once per slot, and that no
pairing repeats. It exists because a hand-written version of the schedule was wrong once already.

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

Every write goes through the `submit-score` edge function, which checks the passcode against a
server-side secret before using the service role key. The passcode is not in this repo.

### Layout

```
data/teams.json          rosters — names only
data/schedule.json       the 8 slots, source of truth
data/raw/                gitignored — raw signup CSV
scripts/                 schedule verification + doc generation
docs/                    format, rules, schedule, logistics, paper scoresheet
supabase/                schema + passcode-gated score submission function
```
