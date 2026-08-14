-- Locking the bracket has to remember WHICH seeding was locked in, otherwise
-- "locked" means nothing — a late pool correction would still reshuffle the
-- semifinals. This stores the frozen seed order at the moment of locking.

alter table public.tournament_state
  add column if not exists locked_seeds text[];
