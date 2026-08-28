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
  const supabase = createClient(projectOrigin(cfg.supabaseUrl), cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  let session = null;
  let profile = null;

  /* ---------- identity ---------- */

  function anonName(uid) {
    return 'anon-' + (uid || '').replace(/-/g, '').slice(0, 4);
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
        found: record.found, tries: record.tries
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

    async signOut() {
      await supabase.auth.signOut();
    }
  };

  /* ---------- wire up ---------- */

  supabase.auth.onAuthStateChange(async (_event, next) => {
    session = next;
    await loadProfile().catch((e) => console.warn('[synonym ladder]', e.message));
    scoreboard.useRemote(driver);
  });

  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (session) await loadProfile().catch((e) => console.warn('[synonym ladder]', e.message));
  scoreboard.useRemote(driver);
}
