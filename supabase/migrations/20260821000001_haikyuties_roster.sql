-- Haikyuties roster confirmed. First names only, by the captain's request.
-- Captain must match a players entry exactly or the roster "C" badge drops off.
-- rosterPending goes to 0 now that all four slots are filled.

update public.teams
  set captain = 'Janna',
      players = array['Janna', 'Shan', 'Martin', 'Jackie']::text[],
      roster_pending = 0
  where id = 'haikyuties';
