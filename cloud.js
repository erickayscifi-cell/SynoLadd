/* ------------------------------------------------------------------
   Supabase driver: Google sign-in, anonymous play, and the shared
   scoreboard. Loaded as a module only when config.js has credentials,
   so the game still runs as a plain static page without it.
   ------------------------------------------------------------------ */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.SL_CONFIG || {};
const scoreboard = window.SLGame && window.SLGame.scoreboard;

/* The dashboard shows the Data API endpoint as
   https://<ref>.supabase.co/rest/v1/ — but the client wants the project
   origin and appends /rest/v1, /auth/v1 and /realtime/v1 itself. Left in
   place, that path would send auth calls to /rest/v1/auth/v1/… and every
   sign-in would fail with a confusing 404. So trim it rather than let the
   mistake bite. */
function projectOrigin(raw) {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  const cleaned = trimmed.replace(/\/(rest|auth|realtime|storage)\/v\d+$/i, '');
  if (cleaned !== trimmed) {
    console.info('[synonym ladder] trimmed the API path from supabaseUrl — using ' + cleaned);
  }
  return cleaned;
}

if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
  console.info('[synonym ladder] no Supabase credentials — scoreboard stays local.');
} else if (!scoreboard) {
  console.warn('[synonym ladder] scoreboard not ready; cloud driver idle.');
} else {
  /* No `lock` option on purpose. Older supabase-js guarded auth work with
     the cross-tab Web Locks API, which could hang sign-in indefinitely;
     current versions coordinate session refreshes without it and warn that
     the option is deprecated. Passing nothing is now both the simplest and
     the recommended choice. */
  const supabase = createClient(projectOrigin(cfg.supabaseUrl), cfg.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  let session = null;
  let profile = null;

  /* ---------- identity ---------- */

  function anonName(uid) {
    return 'anon-' + (uid || '').replace(/-/g, '').slice(0, 4);
  }

  /* Throw away a token that the server will no longer honour, so the next
     click starts clean instead of repeating the same failure. */
  async function discardSession(why) {
    console.warn('[synonym ladder] ' + why + ' — signing out.');
    session = null;
    profile = null;
    try { await supabase.auth.signOut({ scope: 'local' }); } catch (e) {}
  }

  async function loadProfile() {
    if (!session) { profile = null; return null; }
    const { data, error } = await supabase
      .from('profiles').select('username, is_anonymous').eq('id', session.user.id).maybeSingle();
    if (error) console.warn('[synonym ladder] profile read failed:', error.message);
    if (data) { profile = data; return profile; }

    // first sight of this account - claim a name
    const anonymous = !!session.user.is_anonymous;
    const suggested = anonymous
      ? anonName(session.user.id)
      : (session.user.user_metadata?.name || session.user.email || 'reader')
          .split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'reader';
    return claimUsername(suggested, { silent: true });
  }

  async function claimUsername(name, opts = {}) {
    if (!session) throw new Error('not signed in');
    const clean = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (clean.length < 3) throw new Error('names need at least 3 letters, digits, - or _');

    const attempt = async (candidate) => {
      const { data, error } = await supabase.from('profiles').upsert({
        id: session.user.id,
        username: candidate,
        is_anonymous: !!session.user.is_anonymous
      }, { onConflict: 'id' }).select('username, is_anonymous').single();
      if (error) throw error;
      return data;
    };

    try {
      profile = await attempt(clean);
    } catch (err) {
      // 23505 = unique violation: the name is taken
      if (err.code === '23505' && opts.silent) {
        profile = await attempt(clean + '-' + Math.random().toString(36).slice(2, 5));
      } else if (err.code === '23505') {
        throw new Error('“' + clean + '” is taken — try another.');
      } else if (err.code === '23503') {
        // 23503 = foreign key violation: this session's user is gone from
        // auth.users (account deleted, project reset). The stored token is
        // useless, so drop it rather than failing on every write.
        await discardSession('the account this browser was signed in as no longer exists');
        throw new Error('that session was for a deleted account — signed out, try again');
      } else {
        throw err;
      }
    }
    return profile;
  }

  /* ---------- driver ---------- */

  const driver = {
    name: 'supabase',

    identity() {
      if (!session) return { username: null, source: 'none', signedIn: false };
      return {
        username: profile?.username || anonName(session.user.id),
        source: session.user.is_anonymous ? 'anonymous' : 'google',
        signedIn: true,
        email: session.user.email || null
      };
    },

    setUsername(name) { return claimUsername(name); },

    async save(record) {
      if (!session) throw new Error('not signed in');
      const row = {
        id: record.id,
        user_id: session.user.id,
        username: this.identity().username,
        is_anonymous: session.user.is_anonymous === true,
        played_at: record.played_at,
        played_on: record.played_on,
        app_version: record.app_version,
        seed: record.seed, tier: record.tier, mode: record.mode, reason: record.reason,
        score: record.score, raw_score: record.raw_score, penalty: record.penalty,
        entries: record.entries, entry_limit: record.entry_limit,
        entries_left: record.entries_left, hit_rate: record.hit_rate,
        points_per_entry: record.points_per_entry, roots_set_aside: record.roots_set_aside,
        click_aways: record.click_aways, away_seconds: record.away_seconds,
        seconds: record.seconds, words: record.words,
        rung1: record.rung1, rung2: record.rung2, rung3: record.rung3, rung4: record.rung4,
        found: record.found, tries: record.tries, metrics: record.metrics
      };
      const { error } = await supabase.from('rounds').upsert(row, { onConflict: 'id' });
      if (error) throw new Error(error.message);
      return { stored: 'cloud', record };
    },

    async topByTier(tier, limit) {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('*')
        .eq('tier', tier)
        .order('score', { ascending: false })
        .order('seconds', { ascending: true })
        .limit(limit || 25);
      if (error) throw new Error(error.message);
      return data || [];
    },

    async blitzBoard(limit) {
      const { data, error } = await supabase
        .from('blitz_board')
        .select('*')
        .order('score', { ascending: false })
        .order('seconds', { ascending: true })
        .limit(limit || 25);
      if (error) throw new Error(error.message);
      return data || [];
    },

    /* Today's daily standings. The function decides whether to answer —
       it hands back { played: false } until you have filed a daily round
       of your own for today, and never returns the seed word. See
       supabase-daily.sql. */
    async dailyBoard(limit) {
      const { data, error } = await supabase.rpc('daily_board', { p_limit: limit || 25 });
      if (error) throw new Error(error.message);
      return data || { played: false, reason: 'unavailable', players: 0, rows: [] };
    },

    async myRounds(limit) {
      if (!session) return [];
      const { data, error } = await supabase
        .from('rounds').select('*')
        .eq('user_id', session.user.id)
        .order('played_at', { ascending: false })
        .limit(limit || 30);
      if (error) throw new Error(error.message);
      return data || [];
    },

    /* Seed words live in a table with no select policy, reachable only
       through these functions. One practice word at a time, and the daily
       only for today — so the list cannot be dumped and tomorrow cannot be
       read ahead. */
    async practiceSeed(tier, exclude) {
      const { data, error } = await supabase.rpc('practice_seed', {
        p_tier: tier,
        p_exclude: exclude || []
      });
      if (error) throw new Error(error.message);
      return data || null;
    },

    /* Moby's entry for one word. The table has no select policy, so this
       function is the only way in — one word at a time, never the corpus. */
    async thesaurusLinks(word) {
      const { data, error } = await supabase.rpc('related', { p_word: word });
      if (error) throw new Error(error.message);
      return data || null;
    },

    async dailySeed() {
      const { data, error } = await supabase.rpc('daily_seed');
      if (error) throw new Error(error.message);
      return data || null;
    },

    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
      if (error) throw new Error(error.message);
    },

    async signInAnonymously() {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) throw new Error(error.message);
    },

    /* Attach Google to the anonymous account already in play, rather than
       starting a new one. Same user id, so every round stays where it is —
       this is what makes an account portable without inventing a recovery
       code system. An email lands on file only at this moment, for the
       people who deliberately ask for it. */
    async linkGoogle() {
      if (!session) throw new Error('nothing to link — play a round first');
      if (!session.user.is_anonymous) throw new Error('this account is already linked to Google');
      const { error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
      if (error) throw new Error(error.message);
    },

    /* Removes the person, keeps the play. See supabase-account.sql. */
    async deleteAccount() {
      if (!session) throw new Error('not signed in');
      const { data, error } = await supabase.rpc('delete_my_account');
      if (error) throw new Error(error.message);
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
      session = null;
      profile = null;
      return data;
    },

    async signOut() {
      await supabase.auth.signOut();
    }
  };

  /* ---------- wire up ---------- */

  /* Do NOT await other supabase calls inside this callback.
     supabase-js holds an internal auth lock while the handler runs, so a
     query made here waits on a lock that only releases when the handler
     returns — and signInAnonymously() never settles. That is why sign-in
     used to hang on "creating an anonymous account…". Deferring the work
     with setTimeout lets the lock release first. */
  supabase.auth.onAuthStateChange((_event, next) => {
    session = next;
    setTimeout(() => {
      loadProfile()
        .catch((e) => console.warn('[synonym ladder] profile:', e.message))
        .then(() => scoreboard.useRemote(driver));
    }, 0);
  });

  const { data } = await supabase.auth.getSession();
  session = data.session;

  /* getSession() only reads the token in this browser — it does not ask
     whether that user still exists. getUser() does. Checking once at
     startup turns "every write fails forever" into one clean sign-out. */
  if (session) {
    const { error: whoErr } = await supabase.auth.getUser();
    if (whoErr) await discardSession('the stored session is no longer valid (' + whoErr.message + ')');
  }

  if (session) await loadProfile().catch((e) => console.warn('[synonym ladder] profile:', e.message));
  scoreboard.useRemote(driver);
  console.info('[synonym ladder] scoreboard connected' +
    (session ? ' as ' + driver.identity().username : ' (signed out)'));
}
