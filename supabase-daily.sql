-- ==================================================================
-- Synonym Ladder - today's daily board
--
-- The board of everyone who played today's word, shown only to people
-- who have already played it themselves.
--
-- Two halves, and the second is the one that matters:
--
--   1. daily_board() - a security-definer function that returns the
--      day's standings, and refuses if you have not played yet.
--
--   2. a narrower select policy on rounds. Without this, the gate in
--      part 1 is decoration: `rounds` was readable by anyone, so the
--      anon key in config.js could pull today's daily rows straight
--      from the REST API - the seed word, the scores, and `found`,
--      which is the complete answer sheet. A locked door beside an
--      open window is not a lock.
--
-- Run this whole file. Order does not matter; both statements are
-- idempotent.
-- ==================================================================

-- ---------- 1. close the window ------------------------------------
-- Today's daily rows are visible only to their own author until the
-- day is over. Everything else stays as public as it was: practice,
-- blitz, and every daily from any previous day.
--
-- Consequence worth knowing: a daily round no longer appears on its
-- tier leaderboard until the following day. That is the same rule
-- seen from the other side - a daily round on the simple board names
-- today's word to anyone who reads the seed column.

drop policy if exists "rounds are public" on public.rounds;
create policy "rounds are public"
  on public.rounds for select using (
    mode <> 'daily'
    or played_on < (now() at time zone 'utc')::date
    or user_id = auth.uid()
  );

-- ---------- 2. the board itself ------------------------------------
-- Security definer, so it sees past the policy above - and applies its
-- own rule instead: you get the standings once you have a daily round
-- filed for today, and not before.
--
-- The seed word is never returned. You already know it if you have
-- played, so sending it would add nothing and risk everything.

create or replace function public.daily_board(p_limit int default 25)
returns json
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  d      date := (now() at time zone 'utc')::date;
  me     uuid := auth.uid();
  played boolean;
  result json;
begin
  -- Signed out: there is no round in the database under your name, so
  -- there is nothing to unlock. Named separately from 'not-played' so
  -- the page can say which of the two it is.
  if me is null then
    return json_build_object('day', d, 'played', false, 'reason', 'signed-out',
                             'players', 0, 'you', null, 'rows', '[]'::json);
  end if;

  select exists (
    select 1 from public.rounds r
     where r.user_id = me and r.mode = 'daily' and r.played_on = d
  ) into played;

  if not played then
    return json_build_object('day', d, 'played', false, 'reason', 'not-played',
                             'players', 0, 'you', null, 'rows', '[]'::json);
  end if;

  with first_try as (
    -- One row per player: their FIRST attempt, not their best. A daily
    -- is meant to be one shot, and ordering by score would quietly
    -- reward anyone who found a way to file a second.
    select r.user_id, r.username, r.is_anonymous, r.score, r.words,
           r.rung1, r.entries, r.entry_limit, r.hit_rate,
           r.points_per_entry, r.seconds, r.played_at,
           row_number() over (partition by r.user_id order by r.played_at asc) as attempt
      from public.rounds r
     where r.mode = 'daily' and r.played_on = d and r.user_id is not null
  ),
  ranked as (
    select f.*,
           rank() over (order by f.score desc, f.seconds asc, f.played_at asc) as place
      from first_try f
     where f.attempt = 1
  )
  select json_build_object(
           'day', d,
           'played', true,
           'reason', null,
           -- everyone who played, even past the row limit
           'players', (select count(*) from ranked),
           -- your own place, so a long board still tells you where you are
           'you', (select place from ranked where user_id = me),
           'rows', coalesce((
             select json_agg(row_to_json(t) order by t.place)
               from (
                 select place, username, is_anonymous, score, words, rung1,
                        entries, entry_limit, hit_rate, points_per_entry,
                        seconds, played_at,
                        (user_id = me) as mine
                   from ranked
                  order by place
                  limit greatest(coalesce(p_limit, 25), 1)
               ) t
           ), '[]'::json)
         )
    into result;

  return result;
end;
$$;

-- anon may call it; it will simply be told to play first.
grant execute on function public.daily_board(int) to anon, authenticated;

-- ---------- running a table ----------------------------------------
--
-- What today looks like from the inside (bypasses the gate, since you
-- are the owner in the SQL editor):
--
--   select username, score, rung1 as first_order, entries, seconds,
--          played_at at time zone 'America/Chicago' as local_time
--     from public.rounds
--    where mode = 'daily' and played_on = (now() at time zone 'utc')::date
--    order by score desc;
--
-- How many people play the daily each day, over the last fortnight:
--
--   select played_on, count(distinct user_id) as players,
--          round(avg(score)) as avg_score, max(score) as best
--     from public.rounds
--    where mode = 'daily' and played_on > current_date - 14
--    group by played_on order by played_on desc;
--
-- If you ever want a past day fully public again it already is: the
-- policy only withholds the current UTC date.
