# Synonym Ladder

A thesaurus game. A seed word sits at the top; you name synonyms of it (1st order, **8** points each). Once a word is on the board, *its* synonyms count as the next rung out — 2nd order **4**, 3rd **2**, 4th **1**, nothing past the 4th. Results are shown as a four-column table rather than a graph.

Every word carries its **shortest trace** back to the seed. Depths are recomputed after each find, so a later word that opens a shorter route promotes everything behind it: a 4th-order word reachable in three steps becomes 3rd order and scores 2 instead of 1. Links beyond that shortest trace are ignored — there are no loops to untangle, only traces.

A word that links to nothing goes on the red **tries** list at **−1**: misses and misspellings alike, with no spellcheck and no explanation of what went wrong. A word is charged **once** — retry it as often as you like, free, because a word that linked to nothing early can land later as the board grows around it. When it lands it moves onto the board and is struck off the red list; the original −1 stands.

A word sharing a root with something already in play (*discord* and *discordant* are one word) goes to a third, neutral bucket: **same root**. No points, no penalty. It wasn't a wrong answer, it just can't be its own answer — and since root detection is a heuristic, a wrong call there should never cost the player anything.

A round is **20 entries**. A word that lands and a word that misses each spend one; same-root words, repeats of what's already on the board, phrases and empty input are free, and a failed API lookup refunds itself. Spending the last entry ends the round: the input locks, the Round Over panel opens with the metrics and stays there until a new round is started. Twenty entries against eight-point first-order words makes breadth the whole game — there is no room to fish around on the deeper rungs.

The clock starts on the first word entered, not when the puzzle loads.

Two modes: a **daily** puzzle (same word for everyone, UTC date, difficulty ramps up through the week) and **practice** (new word on demand).

The three tiers are **simple**, **literary** and **erudite** — they describe the seed word, not the player. A rarer seed has a thinner thesaurus entry, so there's less to find and further to reach. Internally the keys are still `easy` / `medium` / `hard`, so saved rounds and older `?tier=easy` links keep working; `?tier=simple` works too. Labels live in `TIER_LABELS` at the top of `words.js` — change them there and the whole UI follows.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The game. `data-page="game"`. |
| `scoreboard.html` | The boards, on their own page. `data-page="board"`. Same scripts; `app.js` runs only the half each page has markup for. |
| `privacy.html` | What's stored and how to have it deleted. Hand-edited, no scripts. |
| `styles.css` | Styling, light + dark |
| `engine.js` | Game logic: lookups, rung placement, scoring. No DOM. |
| `app.js` | UI, timer, modes, localStorage |
| `words.js` | Seed word lists per tier, tier labels, and the daily tier schedule |
| `config.js` | Supabase credentials and display settings. Empty by default. |
| `scoreboard.js` | Round records, the local driver, and the driver seam. No DOM. |
| `cloud.js` | Supabase driver: Google + anonymous sign-in, shared board. Loaded only when configured. |
| `supabase-schema.sql` | Tables, constraints, RLS policies, leaderboard view |
| `supabase-promos.sql` | Writer submissions: table, eligibility policy, review queue. Run when ready. |
| `about.html` | About-the-author page. Plain HTML, no scripts — edit by hand. |
| `images/` | Portrait and book covers for the about page (`images/README.txt` has sizes) |
| `test.js` | Engine tests against recorded API payloads (`node test.js`) |
| `test-scoreboard.js` | Scoreboard tests: records, local driver, cloud failover (`node test-scoreboard.js`) |

## Hosting

Pure static files, no build step, no server-side code.

### Recommended: a Git repo wired to the host

Worth the twenty minutes, mostly because of what it buys on the *next* change: a record of what changed and when, one-command rollback when a change breaks the board, and deploys that happen on push instead of by dragging files.

```bash
cd synonym-ladder
git init
git add .
git commit -m "Synonym Ladder: game, scoreboard, about page"
git branch -M main
git remote add origin git@github.com:YOURNAME/synonym-ladder.git
git push -u origin main
```

Then connect the repo to one host and never think about deploys again:

| Host | Setup | Notes |
| --- | --- | --- |
| **Cloudflare Pages** | New project → pick the repo → framework preset **None**, build command **empty**, output dir `/` | Fast, generous free tier, easy custom domain |
| **Netlify** | Add site from Git → build command **empty**, publish dir `.` | Best deploy previews and instant rollback UI |
| **Vercel** | Import repo → framework **Other** | Same idea; preview URLs per commit |
| **GitHub Pages** | Settings → Pages → deploy from `main`, folder `/` | Fewest moving parts, no extra account |

The critical setting on all four is **no build command**. These files are already the finished site; a host that tries to "build" them will either no-op or fail confusingly.

Deploying by hand still works if you prefer:

```bash
rsync -av synonym-ladder/ user@yourserver:/var/www/synonym-ladder/
```

### Three things that catch people out

**`config.js` is committed on purpose.** The project URL and `anon` public key are downloaded by every visitor anyway — publishing them is the design. RLS is the protection. A `service_role` key is the opposite: it bypasses RLS entirely and must never enter the repo. `.gitignore` reserves `secrets.js` and `.env*` for anything of that kind.

**OAuth redirects need every origin allow-listed.** Google sign-in fails on any URL Supabase hasn't been told about — so add the production URL, and `http://localhost:8000` for local work, under **Authentication → URL Configuration**. Netlify and Vercel also give each commit its own preview URL, which will *not* be on the list; add a wildcard (`https://*--yoursite.netlify.app`) or accept that sign-in only works on the real domain.

**Don't add a `package.json` unless you need one.** There are no dependencies, and its presence makes some hosts assume a Node build and go looking for a build script. Run the tests directly instead:

```bash
node test.js && node test-scoreboard.js
```

### Making changes later

The files split along clean seams, so most changes touch exactly one:

- rules, scoring, thesaurus behaviour → `engine.js` (then `node test.js`)
- seed words, tier names → `words.js`
- screen layout and copy → `index.html` (game) or `scoreboard.html` (boards)
- what's stored, or the featured-content disclosure → `privacy.html` / `about.html`, both hand-edited
- interaction, metrics panel, click-aways → `app.js`
- scoreboard storage and accounts → `scoreboard.js` / `cloud.js` (then `node test-scoreboard.js`)
- your author page → `about.html`

Both test files run offline against recorded API payloads, so they're a fast check that a change didn't break scoring before you push it.

**Local check:**

```bash
cd synonym-ladder
python3 -m http.server 8000   # then open http://localhost:8000
```

Use the local server rather than opening `index.html` from disk once Supabase is configured: OAuth redirects need a real origin, and `cloud.js` is an ES module, which browsers refuse to load over `file://`. Without Supabase credentials, opening the file directly still works fine.

## Scoreboard and accounts

The scoreboard has two drivers behind one interface. With `config.js` empty, rounds are kept in the player's own browser and the boards work immediately — useful for testing the game before standing up any infrastructure. Fill in the two Supabase values and the same UI becomes a shared board with real accounts. Nothing else changes.

Two views, matching how the game is meant to be used:

- **Top scores, per tier** — one board each for simple, literary and erudite, showing each player's *best* round on that tier. Per-tier is deliberate: a score on *touch* and a score on *discordant* are not comparable, so a single global board would just rank people by which words they chose. One row per player keeps a strong player from filling the board.
- **Your progress** — every round you have finished, newest first. This is the view that serves the training goal: watch the 1st-order count and points-per-entry climb on the same seed over weeks.

Click any row to expand the full metrics for that round, along with the words found at each rung and the tries that missed. Rounds store their entire metrics blob (`rounds.metrics`), because graph density and language figures depend on the live thesaurus cache and cannot be recomputed from the word list afterwards. Rounds filed before that column existed still open — the app rebuilds the scoring tree and character stats from `found` and marks the rest unavailable rather than inventing it.

### Click-aways, honestly

The board shows an **away** column: how many times the window lost focus during a round, and for how long. It is worth having, and it is worth being careful about what it means.

It cannot tell a thesaurus tab from a Slack notification, a phone call, or a laptop lid. It sees nothing at all if someone looks up words on a second device — which is the obvious way to cheat, and the one this misses entirely. So it is a signal about interruption, not evidence of dishonesty, and the note under the board says so to players.

If competitive integrity ever matters more than it does now, the effective move is server-side verification of the score, not surveillance of the window. That path is already open: every round stores its `found` payload for exactly that purpose.

### Setting up Supabase

1. Create a project at [supabase.com](https://supabase.com) (the free tier is plenty to start).
2. **SQL Editor** → paste `supabase-schema.sql` → Run. That creates `profiles`, `rounds`, the `leaderboard` view, the indexes and the RLS policies.
3. **Authentication → Providers → Google**: enable it, and paste in a Google OAuth client ID and secret from the [Google Cloud console](https://console.cloud.google.com/apis/credentials). Supabase shows you the callback URL to register there.
4. **Authentication → Providers → Anonymous sign-ins**: enable, so people can play without an account.
5. **Authentication → URL Configuration**: add your hosting URL to the redirect allow-list.
6. **Project Settings → API**: copy the Project URL and a browser-safe key into `config.js`. The URL is `https://<project-ref>.supabase.co` — the `.co` API host, not the `supabase.com/dashboard/project/<ref>` address you browse. For the key, either the newer **publishable** key (`sb_publishable_…`) or the legacy **anon public** JWT (`eyJ…`) works; they are interchangeable in the client, and legacy keys are being retired through 2026, so prefer publishable. Never the secret / `service_role` key.

**"Enable automatic RLS" — yes, turn it on.** It installs an event trigger that runs `alter table … enable row level security` on any new table created in the `public` schema. It's redundant for this project's two tables (the schema enables RLS on both explicitly) and it's idempotent, so it changes nothing here — its value is the table you add in six months and forget to protect. A table with RLS on and no policies is unreadable rather than world-readable, which is the right way to fail.

Two things it does *not* cover. It only affects tables created *after* it is installed, so existing tables still need `enable row level security` by hand. And **it does not cover views**, because RLS is a table feature — the `leaderboard` view is protected instead by `with (security_invoker = on)`, which makes it run under the caller's permissions rather than its owner's. Any view you add later needs that setting; auto-RLS will not save you there.

If a future table starts returning empty results or "permission denied" through the anon key, this trigger is why. The fix is to write policies for it, never to disable RLS.

The anon key belongs in the browser — that is what it is for. The `service_role` key never goes near this project. What actually protects the data is the RLS policy set: anyone may read the board, you may only insert rounds under your own `user_id` *and* your own registered username, and there is no update or delete policy at all, so filed rounds are immutable.

### Usernames and anonymity

On first sign-in a profile row is claimed automatically — a Google account gets a name derived from its email or display name, an anonymous account gets `anon-xxxx`. Either can be changed from the scoreboard panel; the `profiles.username` unique constraint rejects collisions, and the client offers a suffixed alternative rather than failing. Anonymous accounts behave exactly like signed-in ones except they cannot be recovered on another device — worth saying plainly in the sign-in sheet, which it does.

Rounds played before signing in aren't lost. They are kept locally marked `pending`, and uploaded the moment a session exists.

### About trusting the client

Right now the browser computes the score and the database stores what it is told. The constraints in the schema catch obviously malformed rows (`score = raw_score − penalty`, entries within the limit, rungs summing to the word count), and RLS stops anyone writing as someone else — but a determined person can still open the console and file a well-formed lie.

That is a reasonable place to be for a practice tool, and a bad place to be if the boards ever carry stakes. The fix is already designed for: every round stores its full `found` payload — each word with its parent and rung — so a Supabase Edge Function can replay the round against Datamuse and recompute the score server-side, then reject or flag the row. Worth doing when the leaderboard starts to matter, not before.

Reasonable middle steps, in order of effort: uncomment the per-account rate-limit trigger in the schema; add a `verified boolean` column and only show verified rounds on the boards; then add the Edge Function.

### Why not Google Sheets

You asked, so: a Sheet is a fine *export* target and a poor source of truth. An Apps Script web app can take POSTs, but it gives you no usable auth, so the endpoint is open to anyone who views the page source; Apps Script has execution quotas and needs `LockService` to survive two people finishing a round at once; and sorting a board gets slow past a few thousand rows. If you want the data in a Sheet for your own analysis, pull it *out* of Postgres periodically instead — one scheduled export, no reliability cost to the game.

## About page

`about.html` is deliberately the dumbest file in the project: plain HTML, no scripts, no data file, no build step. It shares `styles.css` with the game, so it inherits the type, the palette and dark mode for free — but you never have to touch CSS to update it.

Every editable spot is marked with an HTML comment. The three you'll use most:

- **Add a book** — copy one `<article class="book">…</article>` block and edit it. The grid re-flows on its own; two books or seven both look right.
- **Add a link** — copy one `<li>` line under *Elsewhere*.
- **Change the coffee link** — one `href` in the *Support* section. It's a plain link rather than the Buy Me a Coffee widget script, so the page loads instantly and tracks nobody. Ko-fi, Patreon or a Substack subscribe page drop in the same way.

Images go in `images/` and are referenced as `images/yourfile.jpg`. A missing file just shows its alt text and the layout holds, so you can add covers one at a time without ever having a broken-looking page. `images/README.txt` lists the filenames the page expects and the sizes that look best.

The page is linked from the game's header, and links back. If you'd rather it live at a nicer URL, most static hosts will serve `about.html` at `/about` automatically — Netlify, Vercel and Cloudflare Pages all do.

## Writer submissions (planned)

The point of the game is to gather readers and writers; the point of this is to find the ones worth promoting. Design decisions, so they don't get relitigated later:

**Eligibility is participation, not rank.** A Google account (never anonymous) plus five finished rounds. Deliberately *not* tied to a leaderboard position: rank here measures fast thesaurus recall under a 20-entry cap, which is a different skill from writing a book worth reading, and the best novelist in the room may play a mediocre round. Tying a promotional slot to score would also attach a prize to a leaderboard whose scores are still computed in the browser and taken on trust — which is exactly how you invite cheating. Loosening the gate defuses that.

**Promotion is editorial.** You read it, you decide, you paste it into `about.html` by hand. No automation, no ranking algorithm, no runtime rendering of user text.

**Nothing submitted is public until you say so**, and that is enforced by Postgres rather than by the UI. `supabase-promos.sql` creates the table: a submitter may only ever insert or edit rows with status `pending`; the world can read only rows with status `featured`; approving happens from the dashboard, which bypasses RLS. There is deliberately no policy granting anyone the power to feature themselves. URLs are `https`-only at the database level, which rules out `javascript:` and `data:` links before they exist.

The review queue and the promote/reject statements are at the bottom of that file, ready to paste.

Order of work: **Google sign-in first** — it's the gate for all of this, since anonymous accounts can't submit. Then the `promos` table, then a small form in the scoreboard panel for eligible players.

### Three things to sort before people arrive

- **Disclosure.** Say on the About page that featured links are your editorial picks and nobody paid for them. If you ever add affiliate links, that disclosure stops being manners and becomes a legal requirement.
- **A privacy note.** Rounds store a full payload and you have research intentions for the aggregate. Write down what's collected, that board rounds are public, that aggregate analysis may happen, and how someone gets their account deleted. Cheap now, awkward once there are accounts.
- **Impersonation.** A Google sign-in proves an email, not authorship. Your manual review is the only check on "I wrote this" — worth knowing that's the job you're accepting.

## Word data

Synonyms come from the [Datamuse API](https://www.datamuse.com/api/) at runtime — free, no key, no rate limit worth worrying about at test scale (they ask that you get in touch above ~100k requests/day). One `ml=` request per word entered, plus one small `sp=&md=fps` request per word that lands (syllables, part of speech, frequency, for the metrics panel); every response is cached for the session, so retries, sweeps, promotions and the whole metrics panel cost nothing extra.

The check is deliberately generous, because a strict WordNet lookup rejects words players are certain about (`rel_syn=touch` does not list *caress*). So:

- the game queries `ml=` (means-like) and reads Datamuse's score bands and `syn` tag;
- links are checked **in both directions** — *caress* lists *touch* even though *touch* does not list *caress*;
- a `syn` tag or a top-band score is a **strong** link (teal dot); a weaker but real association is a **loose** link (amber dot). Both score the same.

Shared roots are caught locally rather than by the API, in `isVariant()` — the API is happy to treat *discord* and *discordant* as unrelated entries. Three rules, all conservative:

1. the two words reduce to the same crude stem (*touch / touching*, *pinch / pinches*, *obstruct / obstruction*);
2. the shorter word is the whole front of the longer one, allowing a dropped silent *e* (*discord / discordant*, *squeeze / squeezing*);
3. a long shared front with almost nothing left over and a clearly longer partner, for endings that change shape mid-word (*resolve / resolution*, *decline / declination*).

Earlier versions were looser and produced real false positives: *reset* read as the same root as *research* (one mismatched letter allowed at the end), *content* as *contest* (over-eager `-ent` / `-est` stripping), *lick* as *flick* (matching anywhere in the word rather than at the front). Each has a regression test. Stemming now keeps more letters behind word-building endings than behind plain inflections, and matches must start at the front.

Pairs that change shape more drastically still slip through as separate answers (*divide / divisive*, *principle / principal*), and a couple of unrelated pairs get caught (*grave / gravel*). Both directions are cheap now that the bucket is neutral, which is the main reason to keep it that way. `node test.js` includes a sweep over the real word lists asserting no pair of legitimate game answers collides.

Tuning lives in `CONFIG` at the top of `engine.js`:

```js
maxDepth: 4,
points: { 1: 8, 2: 4, 3: 2, 4: 1 },
guessLimit: 40,          // entries per round; roots and duplicates are free
strongScore: 39000000,   // at or above this, or a "syn" tag -> strong link
minScore: 18000000,      // below this, not a link at all -> raise to tighten
fetchMax: 250,           // how many related words to pull per lookup
missPenalty: 1,          // cost of a word that links to nothing (roots are free)
chargeOncePerWord: true, // retries of a tried word are free
autoSweepTries: false    // see below
```

Raise `minScore` if the game feels too permissive; lower it if legitimate guesses get turned away.

**`autoSweepTries`** decides who notices when a red-list word becomes playable. Left `false`, the player has to think of it again and re-enter it — the retry is free, and spotting the opening is part of the game. Set to `true`, the engine re-tests the whole red list after every find and drops any word that now fits straight onto the board (`game.sweep()` does this on demand either way). The sweep costs no requests — every lookup it needs is already cached. Worth trying both ways with testers; the automatic version is friendlier but takes the discovery away.

## Metrics

The **metrics** panel (also opened automatically at the end of a round) reports on the round itself, then on the board as a graph, as language, and as characters. Nearly every row has a tooltip explaining what it measures — hover the dotted labels.

- **Play** — score, points found before the penalty, the penalty itself, entries spent out of the limit, entries left, hit rate, points per entry, how many words were set aside as same-root (free), and **click-aways**.
- **Graph** — nodes, links, density, mean/max degree and which word is the hub, links that fall outside the scoring tree, independent cycles (`E − N + 1`), mean and deepest trace, mean clustering coefficient, leaf count, rung widths, and branching factor between rungs. Edges come from `game.graph()`, which links every pair of board words the thesaurus connects — including the cross-links scoring ignores, so "links off the tree" is a direct measure of how tangled your board is.
- **Language** — part-of-speech mix, mean and maximum syllables, and corpus rarity as log₁₀ uses per million words (lower is rarer), with the rarest and commonest words named. These come from one extra `sp=<word>&md=fps` call per word, which returns real syllable counts and frequencies rather than heuristics. Coverage is reported, since the odd word comes back without frequency data.
- **Characters** — letters on the board, letters actually typed (red list included), mean and median word length, longest and shortest, distinct initials, distinct letters used, and a length histogram.

`game.metrics()` returns all of it as plain data if you want to log rounds or chart them later. Click-aways live in `app.js` rather than the engine, since they're a property of the browser window, not the game.

### Click-aways

The page counts how many times it stopped being frontmost during a round, and how long it was away in total. Two browser events feed one flag: `blur` (another window took focus) and `visibilitychange` (the tab was hidden or the device slept). Some platforms fire only one of the two, and some fire both, so the flag makes a single switch away count once. Both numbers persist with the daily round and appear in the metrics panel.

What this can and cannot see matters if you plan to lean on it:

- It cannot see **where** the player went — no URL, no app name, nothing about the other window. Only that this page lost focus.
- It cannot tell a thesaurus lookup from a phone call, a Slack notification, or a laptop lid closing.
- Focus loss before the first entry isn't counted, since the round hasn't started.
- The clock keeps running while away. Pausing it instead is a couple of lines in `startTimer` / `cameBack` — measure first, then decide.

So it's honest as a signal of interruption or of how long a round really took, and weak as a cheating detector. If cheat-resistance is the goal, the timer and entry limit do more work than this does.

## Notes for the next pass

- `?word=discordant` in the URL forces a practice round on that word — handy for testing a specific seed.
- Scores, streaks and the in-progress daily are stored in the visitor's browser only (`localStorage`). Sharing a leaderboard would need a backend.
- Word lists in `words.js` are hand-picked for having rich neighbourhoods; check a candidate at `https://api.datamuse.com/words?ml=YOURWORD` before adding it, and drop anything that returns only two or three usable words.
