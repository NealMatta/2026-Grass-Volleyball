-- Drop referees.
--
-- The schedule assigned two referee teams per slot and the site displayed
-- them, but the tournament was played self-called and the rotation went
-- unused. Rather than leave a column nobody fills and a rule nobody follows,
-- the whole idea comes out: games are called by the two teams playing them.
--
-- This also frees up the schedule. Referee duty was a scheduling constraint --
-- a team had to be free to take it, and never twice running -- so removing it
-- means a slot off is genuinely off.

alter table public.games drop column if exists ref_team;
