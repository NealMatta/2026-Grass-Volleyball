-- Forfeits — recording a game that was never played.
--
-- The 2026 third-place game went down as Tequila Mockingbird 1 - Haikyuties 0.
-- No such game happened: Haikyuties conceded. There was no way to say that, so
-- whoever entered it reached for the smallest scoreline that would resolve a
-- winner, and the site then printed "1-0" as though it were a result.
--
-- The fix is a flag, not a new score. Keeping the nominal 1-0 means the
-- standings maths is untouched: a forfeit still resolves a winner, and a
-- one-point margin barely moves point differential, which is exactly what a
-- game nobody played should do to the table. Only the display changes -- a
-- flagged game reads "Conceded" instead of a scoreline.

alter table public.games
  add column if not exists forfeit_by text references public.teams(id);

comment on column public.games.forfeit_by is
  'Team that conceded, when the game was never played. The scores stay nominal '
  '(1-0 against the conceding team) so standings and differential are unaffected; '
  'the UI shows "Conceded" rather than the scoreline.';

-- A forfeit only makes sense on a decided game, and only for a team that was
-- actually in it. Bracket games resolve their teams late, so team_a/team_b may
-- be null at scheduling time -- the check only bites once they are known.
alter table public.games drop constraint if exists forfeit_is_final;
alter table public.games add constraint forfeit_is_final check (
  forfeit_by is null or status = 'final'
);

alter table public.games drop constraint if exists forfeit_is_a_player;
alter table public.games add constraint forfeit_is_a_player check (
  forfeit_by is null or forfeit_by = team_a or forfeit_by = team_b
);

-- Backfill the one game this was written for.
update public.games set forfeit_by = 'haikyuties' where id = 'third';
