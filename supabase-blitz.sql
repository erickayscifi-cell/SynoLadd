-- ==================================================================
-- Synonym Ladder - blitz mode
--
-- Rounds played against a countdown. Same words, same scoring, same 20
-- entries; the clock just ends things early. Length is set in
-- config.js (blitzSeconds), not here.
--
-- Run this before anyone plays a blitz round: without it the mode check
-- constraint rejects the insert and rounds are kept locally instead.
-- ==================================================================

-- ---------- let blitz rounds be filed ------------------------------

alter table public.rounds drop constraint if exists rounds_mode_check;
alter table public.rounds add constraint rounds_mode_check
  check (mode in ('daily', 'practice', 'blitz'));

-- ---------- keep them off the untimed boards -----------------------
-- A four-minute round and an unhurried one are not the same contest, so
-- the tier leaderboards ignore blitz. It gets a board of its own below.

drop view if exists public.leaderboard;
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
  where r.user_id is not null
    and r.mode <> 'blitz'
) ranked
where rn = 1;

-- ---------- the blitz board ----------------------------------------
-- One row per player, across all tiers: at a convention table the
-- question is "who did best today", not "who did best on erudite".

create or replace view public.blitz_board
with (security_invoker = on) as
select user_id, username, is_anonymous, seed, tier,
       score, raw_score, penalty, words,
       rung1, rung2, rung3, rung4,
       entries, entry_limit, entries_left, hit_rate, points_per_entry,
       roots_set_aside, click_aways, away_seconds, seconds,
       found, tries, metrics,
       played_at, played_on
from (
  select r.*,
         row_number() over (
           partition by r.user_id
           order by r.score desc, r.seconds asc, r.played_at asc
         ) as rn
  from public.rounds r
  where r.user_id is not null
    and r.mode = 'blitz'
) ranked
where rn = 1;

-- ---------- running a table ----------------------------------------
--
-- Today's blitz rounds, newest first — the view most useful at a booth:
--
--   select username, seed, tier, score, rung1 as first_order, seconds,
--          played_at at time zone 'America/Chicago' as local_time
--     from public.rounds
--    where mode = 'blitz' and played_on = current_date
--    order by score desc;
--
-- How long people actually take, to help pick blitzSeconds:
--
--   select round(avg(seconds)) as avg_seconds,
--          max(seconds) as longest,
--          round(avg(entries)) as avg_entries,
--          count(*) filter (where entries_left > 0) as ended_on_the_clock,
--          count(*) filter (where entries_left = 0) as ended_on_entries
--     from public.rounds where mode = 'blitz';
--
-- That last pair is the dial: if nearly everyone ends on the clock, the
-- timer is doing all the work and could be longer. If nearly everyone
-- runs out of entries first, the clock is decoration.
