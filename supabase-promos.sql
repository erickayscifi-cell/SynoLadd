-- ==================================================================
-- Synonym Ladder - writer submissions ("promos")
--
-- Run this when you are ready to accept submissions. It is independent
-- of supabase-schema.sql and can be run later without touching it.
--
-- The governing rule: nothing a user submits is ever visible to anyone
-- else until you personally set its status to 'featured'. The database
-- enforces that — a user cannot insert or update a row into any status
-- but 'pending', no matter what the browser sends.
-- ==================================================================

create table if not exists public.promos (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users on delete cascade,
  username      text not null,

  title         text not null check (char_length(title) between 2 and 120),
  -- https only: no javascript:, no data:, no plain http
  url           text not null check (url ~ '^https://' and char_length(url) <= 500),
  blurb         text check (char_length(blurb) <= 400),
  kind          text default 'book' check (kind in ('book', 'story', 'newsletter', 'blog', 'other')),

  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected', 'featured')),
  submitted_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewer_note text
);

alter table public.promos enable row level security;

-- ---------- who may read what ------------------------------------

-- Featured rows are the only ones the world can see.
drop policy if exists "featured promos are public" on public.promos;
create policy "featured promos are public"
  on public.promos for select using (status = 'featured');

-- You can always see your own, whatever its status.
drop policy if exists "read own promos" on public.promos;
create policy "read own promos"
  on public.promos for select using (auth.uid() = user_id);

-- ---------- who may submit ---------------------------------------
-- Eligibility lives here rather than in the UI, so an ineligible
-- submission is refused by Postgres and not merely hidden by a button.

drop policy if exists "eligible writers may submit" on public.promos;
create policy "eligible writers may submit"
  on public.promos for insert with check (
    auth.uid() = user_id
    -- status is not the submitter's to choose
    and status = 'pending'
    -- a real account, with the name they play under
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.is_anonymous = false
        and p.username = promos.username
    )
    -- and some actual play behind it
    and (select count(*) from public.rounds r where r.user_id = auth.uid()) >= 5
  );

-- Edits are allowed while a submission is still pending, and cannot
-- change its status — no promoting yourself to 'featured'.
drop policy if exists "edit own pending promo" on public.promos;
create policy "edit own pending promo"
  on public.promos for update
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status = 'pending');

-- Withdrawing a submission is always allowed.
drop policy if exists "withdraw own promo" on public.promos;
create policy "withdraw own promo"
  on public.promos for delete using (auth.uid() = user_id);

-- Approving, rejecting and featuring happen from the dashboard, which
-- bypasses RLS. There is deliberately no policy granting that to anyone.

create index if not exists promos_status_idx on public.promos (status, submitted_at desc);
create index if not exists promos_user_idx   on public.promos (user_id, submitted_at desc);

-- ---------- keep the queue sane ----------------------------------
-- A cap on open submissions per person. In a trigger rather than a
-- policy because a policy that queries its own table can recurse.

create or replace function public.promos_pending_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.promos
       where user_id = new.user_id and status = 'pending') >= 3 then
    raise exception 'you already have three submissions waiting for review';
  end if;
  return new;
end;
$$;

drop trigger if exists promos_cap on public.promos;
create trigger promos_cap before insert on public.promos
  for each row execute function public.promos_pending_cap();

-- ---------- your review queue ------------------------------------
-- Paste into the SQL editor when you sit down to read submissions.
--
--   select p.submitted_at, p.username, p.kind, p.title, p.url, p.blurb,
--          (select count(*) from public.rounds r where r.user_id = p.user_id) as rounds_played,
--          (select max(score)  from public.rounds r where r.user_id = p.user_id) as best_score
--   from public.promos p
--   where p.status = 'pending'
--   order by p.submitted_at;
--
-- To feature one (this is the only step that makes it public):
--
--   update public.promos
--      set status = 'featured', reviewed_at = now(), reviewer_note = 'read it, liked it'
--    where id = '...';
--
-- To turn one down without deleting the record:
--
--   update public.promos
--      set status = 'rejected', reviewed_at = now(), reviewer_note = 'off-topic'
--    where id = '...';
