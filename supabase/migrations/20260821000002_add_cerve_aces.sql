-- Seventh team: Cerve Aces. Adds the team and re-lays the whole pool schedule.
--
-- The seed migration already ran, so db push will not re-apply it. This file is
-- the regenerated seed content, re-dated so it actually runs. Every statement is
-- an idempotent upsert, so applying it twice is harmless.
--
-- What changes: pool play goes from 6 slots / 12 games to 7 slots / 14 games,
-- every pool pairing is reshuffled, and the two bracket slots shift from 7 & 8
-- to 8 & 9 (semis 12:40 -> 1:05, final 1:15 -> 1:40).
--
-- Because p1..p12 keep their ids but change matchups, any score already sitting
-- on them would now be attached to the wrong teams. No real games have been
-- played yet, so the pool rows are reset to 'scheduled' first — this clears
-- leftovers from `npm run dry-run` and nothing else.

begin;

update public.games
  set score_a = null, score_b = null, status = 'scheduled'
  where phase = 'pool';

update public.games
  set score_a = null, score_b = null, status = 'scheduled'
  where phase = 'bracket';

-- Any locked seeding or manual tiebreak still stored describes a six-team
-- field, so it is meaningless now. Back to an unlocked, unseeded state.
update public.tournament_state
  set bracket_locked = false,
      manual_tiebreaks = '{}'::jsonb,
      locked_seeds = null
  where id = 1;

commit;

begin;

-- Teams. Names only: no emails, no phone numbers.
insert into public.teams (id, name, seed, captain, players, roster_pending, has_net, color_a, color_b, blurb) values (
  'deez-nets', 'Deez Nets', 1, 'Michael Keo', array['Michael Keo', 'Cynthia', 'Kevin', 'Nick']::text[],
  0, true, '#2D3561', '#5B6BC0', 'Bringing a net and the pun. Both essential.'
) on conflict (id) do update set
  name = excluded.name, seed = excluded.seed, captain = excluded.captain,
  players = excluded.players, roster_pending = excluded.roster_pending,
  has_net = excluded.has_net, color_a = excluded.color_a,
  color_b = excluded.color_b, blurb = excluded.blurb;
insert into public.teams (id, name, seed, captain, players, roster_pending, has_net, color_a, color_b, blurb) values (
  'haikyuties', 'Haikyuties', 2, 'Janna', array['Janna', 'Shan', 'Martin', 'Jackie']::text[],
  0, false, '#FF6B35', '#F7931E', 'Fly high. Anime rules apply.'
) on conflict (id) do update set
  name = excluded.name, seed = excluded.seed, captain = excluded.captain,
  players = excluded.players, roster_pending = excluded.roster_pending,
  has_net = excluded.has_net, color_a = excluded.color_a,
  color_b = excluded.color_b, blurb = excluded.blurb;
insert into public.teams (id, name, seed, captain, players, roster_pending, has_net, color_a, color_b, blurb) values (
  'tequila-mockingbird', 'Tequila Mockingbird', 3, 'Grant McLean', array['Grant McLean', 'Neil McLean', 'Shannon O''Donoghue', 'Peter Kress']::text[],
  0, true, '#B4D33A', '#E8B33D', 'Best team name in the field and they know it.'
) on conflict (id) do update set
  name = excluded.name, seed = excluded.seed, captain = excluded.captain,
  players = excluded.players, roster_pending = excluded.roster_pending,
  has_net = excluded.has_net, color_a = excluded.color_a,
  color_b = excluded.color_b, blurb = excluded.blurb;
insert into public.teams (id, name, seed, captain, players, roster_pending, has_net, color_a, color_b, blurb) values (
  'cinnamon-rolls', 'Cinnamon Rolls', 4, 'Neal Matta', array['Neal Matta', 'Will', 'Alanah', 'Amy']::text[],
  0, false, '#D98E5F', '#A0522D', 'Your host''s team. Sweet, warm, rolls a lot.'
) on conflict (id) do update set
  name = excluded.name, seed = excluded.seed, captain = excluded.captain,
  players = excluded.players, roster_pending = excluded.roster_pending,
  has_net = excluded.has_net, color_a = excluded.color_a,
  color_b = excluded.color_b, blurb = excluded.blurb;
insert into public.teams (id, name, seed, captain, players, roster_pending, has_net, color_a, color_b, blurb) values (
  'perros-calientes', 'Perros Calientes', 5, 'Alfonso', array['Alfonso', 'Hina', 'Asher', 'Medhi']::text[],
  0, false, '#E63946', '#F4A261', 'Hot dogs. Served on grass.'
) on conflict (id) do update set
  name = excluded.name, seed = excluded.seed, captain = excluded.captain,
  players = excluded.players, roster_pending = excluded.roster_pending,
  has_net = excluded.has_net, color_a = excluded.color_a,
  color_b = excluded.color_b, blurb = excluded.blurb;
insert into public.teams (id, name, seed, captain, players, roster_pending, has_net, color_a, color_b, blurb) values (
  'bumping-buds', 'Bumping Buds', 6, 'Jamie Kolar', array['Jamie Kolar', 'Kim', 'Elvis', 'Diego']::text[],
  0, false, '#E056A0', '#9B59B6', 'Here for the bump and the buds.'
) on conflict (id) do update set
  name = excluded.name, seed = excluded.seed, captain = excluded.captain,
  players = excluded.players, roster_pending = excluded.roster_pending,
  has_net = excluded.has_net, color_a = excluded.color_a,
  color_b = excluded.color_b, blurb = excluded.blurb;
insert into public.teams (id, name, seed, captain, players, roster_pending, has_net, color_a, color_b, blurb) values (
  'cerve-aces', 'Cerve Aces', 7, 'Luke', array['Luke', 'DC Mike', 'Thomas', 'Ally']::text[],
  0, false, '#0E9594', '#3FC1BE', 'Cervezas and aces, in whichever order the day allows.'
) on conflict (id) do update set
  name = excluded.name, seed = excluded.seed, captain = excluded.captain,
  players = excluded.players, roster_pending = excluded.roster_pending,
  has_net = excluded.has_net, color_a = excluded.color_a,
  color_b = excluded.color_b, blurb = excluded.blurb;

-- Games. Scores stay null until a captain submits them.
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p1', 1, 'pool', 1, '10:00', null,
  'cinnamon-rolls', 'cerve-aces', 'deez-nets',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p2', 1, 'pool', 2, '10:00', null,
  'perros-calientes', 'bumping-buds', 'haikyuties',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p3', 2, 'pool', 1, '10:25', null,
  'haikyuties', 'perros-calientes', 'cinnamon-rolls',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p4', 2, 'pool', 2, '10:25', null,
  'deez-nets', 'tequila-mockingbird', 'cerve-aces',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p5', 3, 'pool', 1, '10:50', null,
  'deez-nets', 'cerve-aces', 'perros-calientes',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p6', 3, 'pool', 2, '10:50', null,
  'cinnamon-rolls', 'bumping-buds', 'tequila-mockingbird',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p7', 4, 'pool', 1, '11:15', null,
  'haikyuties', 'cinnamon-rolls', 'deez-nets',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p8', 4, 'pool', 2, '11:15', null,
  'tequila-mockingbird', 'perros-calientes', 'bumping-buds',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p9', 5, 'pool', 1, '11:40', null,
  'haikyuties', 'cerve-aces', 'tequila-mockingbird',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p10', 5, 'pool', 2, '11:40', null,
  'deez-nets', 'bumping-buds', 'cinnamon-rolls',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p11', 6, 'pool', 1, '12:05', null,
  'perros-calientes', 'cerve-aces', 'bumping-buds',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p12', 6, 'pool', 2, '12:05', null,
  'tequila-mockingbird', 'cinnamon-rolls', 'haikyuties',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p13', 7, 'pool', 1, '12:30', null,
  'deez-nets', 'haikyuties', 'cerve-aces',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'p14', 7, 'pool', 2, '12:30', null,
  'tequila-mockingbird', 'bumping-buds', 'perros-calientes',
  null, null,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;

-- Bracket rows reference semifinal ids, so they must land after the pool rows.
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'sf1', 8, 'bracket', 1, '1:05', 'Semifinal 1',
  null, null, null,
  1, 4,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'sf2', 8, 'bracket', 2, '1:05', 'Semifinal 2',
  null, null, null,
  2, 3,
  null, null,
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'final', 9, 'bracket', 1, '1:40', 'Final',
  null, null, null,
  null, null,
  'sf1', 'sf2',
  null, null
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;
insert into public.games (id, slot, phase, court, start_time, label, team_a, team_b, ref_team, a_seed, b_seed, a_winner_of, b_winner_of, a_loser_of, b_loser_of) values (
  'third', 9, 'bracket', 2, '1:40', '3rd Place',
  null, null, null,
  null, null,
  null, null,
  'sf1', 'sf2'
) on conflict (id) do update set
  slot = excluded.slot, phase = excluded.phase, court = excluded.court,
  start_time = excluded.start_time, label = excluded.label,
  team_a = excluded.team_a, team_b = excluded.team_b, ref_team = excluded.ref_team,
  a_seed = excluded.a_seed, b_seed = excluded.b_seed,
  a_winner_of = excluded.a_winner_of, b_winner_of = excluded.b_winner_of,
  a_loser_of = excluded.a_loser_of, b_loser_of = excluded.b_loser_of;

commit;
