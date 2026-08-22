# Format

**7 teams · 2 courts · ~4¼ hours · every team plays 5–6 games**

---

## The problem this format solves

Neal wanted single elimination *and* for everyone to play as much as possible. Those conflict
directly — in a 7-team single-elimination bracket, most of the field plays one game and goes home.

The resolution: **nobody is eliminated until the bracket, and the bracket has a placement game so a
knocked-out team still plays again.**

## Why not Montrose's Tiered Swiss

Montrose runs Tiered Swiss. That's the right call for them and the wrong one for us.

Swiss exists to *approximate* a round robin when you have too many teams to play everyone. With 7
teams, you can still get most of the way there by just playing. Montrose's own writeup admits the
weakness — *"please note this will be an ish because if everyone goes 1-1 everytime I will do my
best."* A near-round-robin
has no pairing problem to solve, produces no rematches, and gives clean bracket seeding.

So: **near round robin → seeded bracket.**

---

## Structure

### Pool play — 7 slots, 14 games

Each team plays **4 of the 6** other teams. In every slot, exactly 4 teams play, **2 of the 3 free
teams referee**, one per court, and one team is genuinely off.

| Team | Your day, slot by slot | Plays | Refs | Free | Doesn't face |
|:--|:--|:--|:--|:--|:--|
| Deez Nets | R **P** **P** R **P** · **P** | 2, 3, 5, 7 | 1, 4 | 6 | Cinnamon Rolls, Perros Calientes |
| Haikyuties | R **P** · **P** **P** R **P** | 2, 4, 5, 7 | 1, 6 | 3 | Tequila Mockingbird, Bumping Buds |
| Tequila Mockingbird | · **P** R **P** R **P** **P** | 2, 4, 6, 7 | 3, 5 | 1 | Haikyuties, Cerve Aces |
| Cinnamon Rolls | **P** R **P** **P** R **P** · | 1, 3, 4, 6 | 2, 5 | 7 | Deez Nets, Perros Calientes |
| Perros Calientes | **P** **P** R **P** · **P** R | 1, 2, 4, 6 | 3, 7 | 5 | Deez Nets, Cinnamon Rolls |
| Bumping Buds | **P** · **P** R **P** R **P** | 1, 3, 5, 7 | 4, 6 | 2 | Haikyuties, Cerve Aces |
| Cerve Aces | **P** R **P** · **P** **P** R | 1, 3, 5, 6 | 2, 7 | 4 | Tequila Mockingbird, Bumping Buds |

**P** = playing · **R** = refereeing · **·** = free.

Every team plays 4, referees 2, and gets one slot completely off. Ref load is perfectly even.

### The rhythm rule

A balanced schedule isn't enough on its own — "you play 4 games" is no comfort if those four are
back to back after sitting for three slots. So the schedule is built to three more constraints:

- **Never more than 2 games in a row.** You play at most a pair, then you're off.
- **Never two slots off in a row.** You don't go cold waiting around.
- **Never referee two slots in a row.** Ref duty is spread out, not stacked.

Read any row above left to right and you'll see the same shape: short bursts of play broken up by a
ref slot or a rest. `scripts/verify-schedule.mjs` asserts all three — they're invariants, not good
intentions.

### Why 4 games each and not more

Seven teams on two courts is a hard arithmetic constraint. Every game uses 2 teams, so for everyone
to play the *same* number of games, `7 × games` has to come out even — meaning games per team has
to be an even number. Four works: 14 games, 7 slots. The next option up is six, which is a full
round robin — 21 games, 10½ slots, roughly 4½ hours of pool play before the bracket even starts.
That doesn't fit the day.

So 4 it is. The total game count still goes up: 12 games with six teams, **14 with seven**.

Seven of the twenty-one possible pairings don't happen — that's the cost of fitting into an
afternoon on 2 courts. With no draft or pre-ranking, which seven get dropped is arbitrary.

> These invariants are enforced by `scripts/verify-schedule.mjs`, not by trust. Run it after any
> schedule edit. A hand-written version of this table was wrong once already.

### Bracket — 2 slots

Seeded 1–7 by pool record. **Auto-computed by the site** the moment the 14th pool game is entered.

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

  #5, #6 and #7 finish on pool record.
```

**Game count per team:** 4 pool + 1–2 bracket = **5–6 games**.

Seeds #5, #6 and #7 don't get a bracket game. Both courts are busy for both bracket slots, so
there is no room for a placement game below the top four — that would need a third court or a
longer day. This is the real cost of the seventh team: three teams finish after pool play instead
of two.

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
| 7 | 12:30 | Pool |
| — | 12:55 | **Break — standings posted, bracket seeded** |
| 8 | 1:05 | Semifinals |
| 9 | 1:40 | **Final** + 3rd place |

Done **~2:10pm**. Total ~4h10m.

The seventh team costs 25 minutes: one extra pool slot, and everything after it shifts back.

Slots are 25 minutes, which includes swapping teams on and off. There is no slack in the day — nine
slots on two courts is exactly what fits between 10:00 and 2:10.

---

## Seeding

Pool record ranks all seven teams. Tiebreakers apply in order:

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

**A net doesn't show up.** Down to one court, the format does not fit — 14 pool games at 25 minutes
is nearly 6 hours on a single court. Fallback: drop to a pod format (pods of 4 and 3, each team
plays 2–3, top team from each pod plus best record to a short final round). Decide before 10am, not
at noon.

**A team doesn't show up.** With 6 teams, fall back to the six-team schedule — 6 slots, 12 games,
everyone plays 4 and refs 2, done by ~1:45. It's in the git history; regenerate it rather than
improvise. With 5 teams, run a true full round robin — 10 games, 5 slots, everyone plays everyone,
top 2 to a final.

**A team is short players.** They play with 3. It's in the rules — but the one-woman-on-court
minimum still applies at 3, so a team that can't field one has to borrow a player.
