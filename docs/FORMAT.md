# Format

**6 teams · 2 courts · ~4 hours · every team plays 5–6 games**

---

## The problem this format solves

Neal wanted single elimination *and* for everyone to play as much as possible. Those conflict
directly — in a 6-team single-elimination bracket, half the field plays one game and goes home.

The resolution: **nobody is eliminated until the bracket, and the bracket has a placement game so a
knocked-out team still plays again.**

## Why not Montrose's Tiered Swiss

Montrose runs Tiered Swiss. That's the right call for them and the wrong one for us.

Swiss exists to *approximate* a round robin when you have too many teams to play everyone. With 6
teams, you can nearly just play everyone. Montrose's own writeup admits the weakness — *"please note
this will be an ish because if everyone goes 1-1 everytime I will do my best."* A near-round-robin
has no pairing problem to solve, produces no rematches, and gives clean bracket seeding.

So: **near round robin → seeded bracket.**

---

## Structure

### Pool play — 6 slots, 12 games

Each team plays **4 of the 5** other teams. In every slot, exactly 4 teams play and the **2 free
teams referee**, one per court.

| Team | Plays slots | Rests | Refs | Doesn't face |
|:--|:--|:--|:--|:--|
| Deez Nets | 1, 3, 4, 6 | 2, 5 | 2 | Haikyuties |
| Haikyuties | 1, 2, 4, 5 | 3, 6 | 2 | Deez Nets |
| Tequila Mockingbird | 2, 3, 4, 6 | 1, 5 | 2 | Bumping Buds |
| Cinnamon Rolls | 2, 3, 5, 6 | 1, 4 | 2 | Perros Calientes |
| Perros Calientes | 1, 3, 5, 6 | 2, 4 | 2 | Cinnamon Rolls |
| Bumping Buds | 1, 2, 4, 5 | 3, 6 | 2 | Tequila Mockingbird |

Every team plays 4, rests 2, referees 2. Ref load is perfectly even.

Three of the fifteen possible pairings don't happen — that's the cost of fitting into 4 hours on 2
courts. With no draft or pre-ranking, which three get dropped is arbitrary.

> These invariants are enforced by `scripts/verify-schedule.mjs`, not by trust. Run it after any
> schedule edit. A hand-written version of this table was wrong once already.

### Bracket — 2 slots

Seeded 1–6 by pool record. **Auto-computed by the site** the moment the 12th pool game is entered.

```
        Semifinals              Final
  #1 ──┐
       ├── SF1 winner ──┐
  #4 ──┘                │
                        ├── CHAMPION
  #2 ──┐                │
       ├── SF2 winner ──┘
  #3 ──┘

  SF1 loser ──┐
              ├── 3rd place
  SF2 loser ──┘

  #5 and #6 finish 5th and 6th on pool record.
```

**Game count per team:** 4 pool + 1–2 bracket = **5–6 games**.

Seeds #5 and #6 don't get a bracket game. On 2 courts in 4 hours there is no slot for one — a 5th
place game would need a third court or a longer day.

---

## Timeline

| Slot | Time | Phase |
|:--|:--|:--|
| 1 | 10:00 | Pool |
| 2 | 10:25 | Pool |
| 3 | 10:50 | Pool |
| 4 | 11:15 | Pool |
| 5 | 11:40 | Pool |
| 6 | 12:05 | Pool |
| — | 12:30 | **Break — standings posted, bracket seeded** |
| 7 | 12:40 | Semifinals |
| 8 | 1:15 | **Final** + 3rd place |

Done **~1:50pm**. Total ~3h50m.

Slots are 25 minutes: a 21-minute hard cap on play plus 4 minutes to swap teams on and off. There is
no slack. **This only works if games end on time** — hence the horn rule.

---

## Seeding

Pool record ranks all six teams. Tiebreakers apply in order:

1. **Wins**
2. **Head-to-head**
3. **Point differential**
4. **Points scored**
5. **Rock paper scissors**

Steps 1–4 are computed by the site. Step 5 can't be — if two teams are level through all four, the
site flags it and Neal settles it with the captains.

**This is why both scores are recorded, not just the winner.** A 21-8 win and a 21-19 win are the
same in the standings column and very different in the seeding. Play games out.

---

## If something goes wrong

**A net doesn't show up.** Down to one court, the format does not fit — 12 pool games at 25 minutes
is 5 hours on a single court. Fallback: drop to a 3-slot pod format (two pods of 3, each team plays
2, top team from each pod plus best record to a 3-game final round). Decide before 10am, not at noon.

**A team doesn't show up.** With 5 teams, run a true full round robin — 10 games, 5 slots, every
team plays everyone, top 2 to a final. Cleaner than what we have now, honestly.

**A team is short players.** They play with 3. It's in the rules.
