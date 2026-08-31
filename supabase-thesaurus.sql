-- ==================================================================
-- Synonym Ladder - Moby Thesaurus II in Postgres
--
-- Public domain, 30,260 root words, ~2.5 million related terms,
-- derived from the 1911 Roget's. It is far more generous than the
-- WordNet synonymy behind Datamuse's "syn" tags — which is the point:
-- Datamuse knows one synonym for "apocryphal"; Roget knows dozens.
--
--   https://www.gutenberg.org/ebooks/3202   (mthesaur.txt, ~24 MB)
--
-- Like the seeds table, this one has no select policy. The client can
-- ask about a single word through related(); it cannot dump the corpus.
-- ==================================================================

-- ---------- 1. staging -------------------------------------------
-- One row per line of the file, unparsed.

create table if not exists public.thesaurus_raw (line text);

-- ---------- 2. the real table ------------------------------------

create table if not exists public.thesaurus (
  word     text primary key,
  synonyms text[] not null
);

alter table public.thesaurus enable row level security;
-- Deliberately no policies: reachable only through related() below.

-- ---------- 3. importing -----------------------------------------
--
-- CHECK THE FILE FIRST. Some wordlist repositories flatten their sources
-- to one word per line, which destroys the grouping this depends on.
-- In PowerShell:
--
--   (Get-Item mthesaur.txt).Length / 1MB          # expect ~24
--   (Get-Content mthesaur.txt | Measure-Object -Line).Lines   # expect ~30,260
--   Get-Content mthesaur.txt -TotalCount 2
--
-- A good line looks like this — root word, then its related terms:
--
--   abaca,abaca fiber,agave,bowstring hemp,fique,hemp,henequen,istle,...
--
-- If every line holds a single word with no commas, that copy has been
-- flattened; fetch the original from gutenberg.org/files/3202/ instead.
--
-- Each line is "rootword,syn,syn,syn,..." — every line has a different
-- number of commas, so a plain CSV import fails: it tries to make columns
-- of them and demands a consistent count. The whole line has to arrive as
-- a single value. Two ways, depending on whether you have psql.
--
-- ---- PATH A: psql, no preprocessing at all -----------------------
--
-- Tell COPY that the delimiter and quote are bytes the file cannot
-- contain, and every line lands whole in one column.
-- Connection string: Project Settings → Database → Connection string.
--
--   psql "postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres" ^
--     -c "\copy public.thesaurus_raw(line) from 'mthesaur.txt' with (format csv, delimiter E'\x01', quote E'\x02')"
--
-- 30,260 rows in a couple of seconds. Then skip to step 4.
--
-- ---- PATH B: no psql, use the dashboard importer -----------------
--
-- Split each line into two proper CSV columns — the root word, and
-- everything after the first comma — with the second field quoted so its
-- commas stay inside it. In PowerShell, from the folder with the file:
--
--   $out = [System.IO.StreamWriter]::new("$PWD\moby.csv", $false, [System.Text.UTF8Encoding]::new($false))
--   $out.WriteLine('word,synonyms')
--   foreach ($line in [System.IO.File]::ReadLines("$PWD\mthesaur.txt")) {
--     $i = $line.IndexOf(',')
--     if ($i -lt 1) { continue }
--     # Strip quote characters rather than escaping them. Moby has no
--     # meaningful ones, and a single stray quote makes an importer read
--     # the field as ending early — "Trailing quote on quoted field is
--     # malformed", which costs you that row.
--     $w    = $line.Substring(0, $i).Replace('"','').Replace([char]0x201C,'').Replace([char]0x201D,'')
--     $rest = $line.Substring($i + 1).Replace('"','').Replace([char]0x201C,'').Replace([char]0x201D,'')
--     $out.WriteLine('"' + $w + '","' + $rest + '"')
--   }
--   $out.Close()
--
-- To see what upset a particular row, subtract 1 for the header line:
--   (Get-Content mthesaur.txt)[284..286]
--
-- That writes moby.csv with exactly two columns on every row. Import it
-- into a two-column staging table:
--
--   create table if not exists public.thesaurus_load (word text, synonyms text);
--
-- Table editor → thesaurus_load → Import data from CSV. Then use the
-- PATH B insert in step 4 instead of the PATH A one.

-- ---------- 4. parse it ------------------------------------------
-- Single words only, on both sides, because the game only accepts single
-- words as answers. Multi-word roots like "a la mode" are dropped, and so
-- are multi-word synonyms like "out of the question". Expect roughly a
-- fifth of the file to fall away for this reason — that is the intent,
-- not a fault.

-- Note the filter is applied to the ORIGINAL text, before lowercasing.
-- That is what excludes proper nouns: Moby's entry for "apocryphal"
-- opens with Albigensian, Arian, Catharist, Donatist — sect names Roget
-- filed under heterodoxy. Nobody offers those as a synonym, and matching
-- '^[a-z]' drops them while keeping every ordinary word.

-- ---- if your staging table has two columns (word, synonyms) ------
-- This is what the PowerShell path produces.

-- The filtering has to happen in a subquery: when every term in a row is
-- multi-word or a proper noun, array_agg returns NULL rather than an empty
-- array, and synonyms is NOT NULL. "bushfighting" is one such row — all of
-- its Moby terms are phrases. Those roots are simply skipped.

insert into public.thesaurus (word, synonyms)
select word, synonyms
  from (
    select lower(btrim(r.word)) as word,
           (select array_agg(distinct lower(btrim(part)))
              from unnest(string_to_array(r.synonyms, ',')) part
             where btrim(part) ~ '^[a-z][a-z''-]{1,30}$'
           ) as synonyms
      from public.thesaurus_raw r
     where btrim(r.word) ~ '^[a-z][a-z''-]{1,30}$'
  ) parsed
 where synonyms is not null
   and cardinality(synonyms) > 0
on conflict (word) do nothing;

-- ---- if your staging table has one column (line) -----------------
-- This is what the psql COPY path produces.
--
-- insert into public.thesaurus (word, synonyms)
-- select lower(btrim(split_part(line, ',', 1))) as word,
--        (select array_agg(distinct lower(btrim(part)))
--           from unnest(string_to_array(line, ',')) with ordinality as u(part, i)
--          where i > 1 and btrim(part) ~ '^[a-z][a-z''-]{1,30}$') as synonyms
--   from public.thesaurus_raw
--  where line ~ '^[a-z][a-z''-]{1,30},'
-- on conflict (word) do nothing;

-- (No cleanup delete needed: the subquery above never inserts an empty row.)

-- Check the import before trusting it:
--   select count(*) as roots,
--          sum(cardinality(synonyms)) as links,
--          round(avg(cardinality(synonyms))) as avg_per_word
--     from public.thesaurus;
--
-- Expect roughly 30,000 roots and an average in the dozens. A few hundred
-- roots, or an average of 1, means the source file was flattened — go back
-- to step 3 rather than trusting what landed.
--
-- Expect roughly 30,000 roots. And the word that started this:
--   select synonyms from public.thesaurus where word = 'apocryphal';

-- The staging table can go once you are happy:
--   drop table public.thesaurus_raw;

-- ---------- 5. the lookup ----------------------------------------

create or replace function public.related(p_word text)
returns text[]
language sql
security definer
stable
set search_path = public
as $$
  select synonyms from public.thesaurus where word = lower(btrim(p_word));
$$;

grant execute on function public.related(text) to anon, authenticated;

-- ---------- notes ------------------------------------------------
--
-- Moby is LOOSE. It lists related terms, not strict synonyms, so the
-- game becomes markedly more permissive — closer to the original
-- Synonuity, which accepted "kick" and "blow" for "touch". The client
-- marks Moby-only links as loose (amber dot); Datamuse keeps ownership
-- of what counts as a strong link.
--
-- If rounds start feeling too easy, the honest lever is the entry
-- limit rather than throwing links away: 20 entries against a richer
-- board is a different, harder optimisation than 20 against a thin one.
--
-- With the thesaurus living here, a future Edge Function can replay a
-- submitted round entirely inside Postgres and recompute its score —
-- the groundwork for verifying the leaderboard without trusting the
-- browser.
