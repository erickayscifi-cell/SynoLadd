-- ==================================================================
-- Synonym Ladder - database schema
-- Paste into the Supabase SQL editor and run once.
--
-- Shape of the trust model: reads are public, writes are only ever
-- your own rows, and rounds cannot be edited or deleted after the
-- fact. The anon key in config.js is public by design; these policies
-- are what actually protect the data.
-- ==================================================================

-- ---------- profiles: one chosen name per account ------------------

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  username     text not null unique
               check (username ~ '^[a-z0-9_-]{3,20}$'),
  is_anonymous boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Names are shown on the board, so anyone may read them.
drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public"
  on public.profiles for select using (true);

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert"
  on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------- rounds: one row per finished round ---------------------

create table if not exists public.rounds (
  id               uuid primary key,
  user_id          uuid not null references auth.users on delete cascade,
  username         text not null,          -- denormalised so the board is one read
  is_anonymous     boolean not null default false,

  played_at        timestamptz not null default now(),
  played_on        date not null,
  app_version      text,

  seed             text not null,
  tier             text not null check (tier in ('easy', 'medium', 'hard')),
  mode             text not null check (mode in ('daily', 'practice')),
  reason           text,

  -- play metrics, mirroring the metrics panel
  score            integer not null,
  raw_score        integer not null check (raw_score >= 0),
  penalty          integer not null check (penalty >= 0),
  entries          integer not null check (entries between 0 and 500),
  entry_limit      integer not null check (entry_limit between 1 and 500),
  entries_left     integer not null check (entries_left >= 0),
  hit_rate         numeric(4,2),
  points_per_entry numeric(6,2),
  roots_set_aside  integer default 0,
  click_aways      integer default 0,
  away_seconds     integer default 0,
  seconds          integer not null check (seconds >= 0),

  -- board shape
  words            integer not null check (words >= 0),
  rung1            integer default 0,
  rung2            integer default 0,
  rung3            integer default 0,
  rung4            integer default 0,

  -- kept so a round can be re-checked against the thesaurus later
  found            jsonb not null,
  tries            jsonb,

  -- the full metrics blob, so a stored round can be reopened in detail.
  -- Graph and language figures depend on the live thesaurus cache and
  -- cannot be recomputed from `found` alone, so they are kept here.
  metrics          jsonb,

  created_at       timestamptz not null default now(),

  -- cheap sanity rails; real verification belongs in an Edge Function
  constraint entries_fit_limit check (entries <= entry_limit),
  constraint score_is_consistent check (score = raw_score - penalty),
  constraint words_match_rungs check (words = rung1 + rung2 + rung3 + rung4),
  constraint found_is_array check (jsonb_typeof(found) = 'array'),
  constraint found_not_huge check (jsonb_array_length(found) <= 200)
);

alter table public.rounds enable row level security;

-- The leaderboard is the point, so reads are open to everyone.
drop policy if exists "rounds are public" on public.rounds;
create policy "rounds are public"
  on public.rounds for select using (true);

-- You may only file your own rounds, under your own name.
drop policy if exists "insert own rounds" on public.rounds;
create policy "insert own rounds"
  on public.rounds for insert with check (
    auth.uid() = user_id
    and username = (select username from public.profiles where id = auth.uid())
  );

-- No update and no delete policy: rounds are immutable once filed.

create index if not exists rounds_tier_score_idx on public.rounds (tier, score desc, seconds);
create index if not exists rounds_user_played_idx on public.rounds (user_id, played_at desc);
create index if not exists rounds_seed_score_idx  on public.rounds (seed, score desc);
create index if not exists rounds_played_on_idx   on public.rounds (played_on);

-- ---------- already ran this file before? ------------------------
-- Adding a column to a live table. Safe to run repeatedly; existing rows
-- keep a null metrics blob and the app rebuilds what it can from `found`.
--
--   alter table public.rounds add column if not exists metrics jsonb;
--
-- The view below also needs recreating to expose it, which the
-- create-or-replace further down handles on its own.

-- ---------- leaderboard: best round per player, per tier ----------
-- One row per player keeps a single strong player from filling the board.
-- security_invoker makes the view obey the caller's RLS, not the owner's.

create or replace view public.leaderboard
with (security_invoker = on) as
select tier, user_id, username, is_anonymous, seed, mode,
       score, raw_score, penalty, words,
       rung1, rung2, rung3, rung4,
       entries, entry_limit, entries_left, hit_rate, points_per_entry,
       roots_set_aside, click_aways, away_seconds, seconds,
       found, tries, metrics,
       played_at, played_on
from (
  select r.*,
         row_number() over (
           partition by r.tier, r.user_id
           order by r.score desc, r.seconds asc, r.played_at asc
         ) as rn
  from public.rounds r
) ranked
where rn = 1;

-- ---------- keep updated_at honest --------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- optional: rate limit per account ----------------------
-- Uncomment to cap how fast one account can file rounds. A 20-entry
-- round takes minutes to play, so this only bites automated posting.
--
-- create or replace function public.rounds_rate_limit()
-- returns trigger language plpgsql as $$
-- begin
--   if (select count(*) from public.rounds
--        where user_id = new.user_id
--          and played_at > now() - interval '1 minute') >= 3 then
--     raise exception 'slow down: too many rounds filed in the last minute';
--   end if;
--   return new;
-- end;
-- $$;
--
-- drop trigger if exists rounds_rate on public.rounds;
-- create trigger rounds_rate before insert on public.rounds
--   for each row execute function public.rounds_rate_limit();
