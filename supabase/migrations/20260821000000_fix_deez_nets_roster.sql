-- Roster correction: Claire is out, Kevin is in on Deez Nets.
-- The seed migration already ran, so db push will not re-apply it; this
-- targeted update keeps the database in step with data/teams.json.

update public.teams
  set players = array['Michael Keo', 'Cynthia', 'Kevin', 'Nick']::text[]
  where id = 'deez-nets';
