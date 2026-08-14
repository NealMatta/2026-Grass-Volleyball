-- 2026 Grass Volleyball — schema
--
-- Threat model: this is a public site with a public anon key. Anyone can read.
-- Nobody may write through the anon key — all writes go through the
-- submit-score edge function, which checks a shared passcode and then uses the
-- service role key (which bypasses RLS). Without this, any visitor could
-- rewrite the tournament scores.
--
-- No emails or phone numbers are stored here. Ever.

create table if not exists public.teams (
  id              text primary key,
  name            text not null,
  seed            int  not null,          -- signup order; NOT a ranking
  captain         text not null,
  players         text[] not null default '{}',
  roster_pending  int  not null default 0,
  has_net         boolean not null default false,
  color_a         text not null,
  color_b         text not null,
  blurb           text
);

create table if not exists public.games (
  id          text primary key,
  slot        int  not null,
  phase       text not null check (phase in ('pool', 'bracket')),
  court       int  not null,
  start_time  text not null,
  label       text,

  -- Pool games reference teams directly.
  team_a      text references public.teams(id),
  team_b      text references public.teams(id),
  ref_team    text references public.teams(id),

  -- Bracket games reference positions that resolve once pool play ends.
  a_seed      int,
  b_seed      int,
  a_winner_of text references public.games(id),
  b_winner_of text references public.games(id),
  a_loser_of  text references public.games(id),
  b_loser_of  text references public.games(id),

  score_a     int check (score_a >= 0),
  score_b     int check (score_b >= 0),
  status      text not null default 'scheduled' check (status in ('scheduled', 'final')),
  updated_at  timestamptz not null default now(),

  -- A final game must have both scores; a scheduled one must have neither.
  constraint scores_match_status check (
    (status = 'final'     and score_a is not null and score_b is not null) or
    (status = 'scheduled' and score_a is null     and score_b is null)
  ),
  -- Volleyball has no ties.
  constraint no_ties check (status <> 'final' or score_a <> score_b)
);

create index if not exists games_slot_idx on public.games (slot, court);

-- Single-row table for tournament-wide state.
create table if not exists public.tournament_state (
  id               int primary key default 1 check (id = 1),
  bracket_locked   boolean not null default false,
  -- Manual tiebreaks for dead heats the computed chain cannot resolve.
  -- Shape: { "<sorted|team|ids>": ["winner-id", "loser-id"] }
  manual_tiebreaks jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

insert into public.tournament_state (id) values (1) on conflict (id) do nothing;

-- Row level security ---------------------------------------------------------
alter table public.teams            enable row level security;
alter table public.games            enable row level security;
alter table public.tournament_state enable row level security;

-- Read-only for everyone. No insert/update/delete policies exist, so the anon
-- and authenticated roles cannot write. The service role bypasses RLS entirely.
drop policy if exists "public read teams" on public.teams;
create policy "public read teams" on public.teams
  for select to anon, authenticated using (true);

drop policy if exists "public read games" on public.games;
create policy "public read games" on public.games
  for select to anon, authenticated using (true);

drop policy if exists "public read state" on public.tournament_state;
create policy "public read state" on public.tournament_state
  for select to anon, authenticated using (true);

-- Realtime -------------------------------------------------------------------
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.tournament_state;
