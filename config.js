/* ------------------------------------------------------------------
   Deployment settings. Everything here is safe to publish: the anon key
   is designed to sit in a browser, and Row Level Security in the database
   is what actually decides who may write. Never paste a service_role key
   into this file.

   Leave the two Supabase values empty and the game runs exactly as before,
   with the scoreboard kept in each player's own browser.
   ------------------------------------------------------------------ */

window.SL_CONFIG = {
  // The project ORIGIN only — no path, no trailing slash. The client adds
  // /rest/v1, /auth/v1 and the rest on its own.
  //   dashboard address   https://supabase.com/dashboard/project/<ref>  ✗
  //   Data API endpoint   https://<ref>.supabase.co/rest/v1/            ✗
  //   what goes here      https://<ref>.supabase.co                     ✓
  // (A stray /rest/v1 is trimmed automatically, with a console note.)
  supabaseUrl: '',

  // Project Settings → API keys. Either the newer "publishable" key
  // (sb_publishable_…) or the legacy "anon public" JWT (eyJ…) works — they
  // are interchangeable here. Legacy keys are being retired through 2026,
  // so prefer the publishable one. Never the secret / service_role key.
  supabaseAnonKey: '',

  appVersion: '0.5',      // stored with each round, so old data stays readable
  boardSize: 25,          // rows shown per leaderboard
  historySize: 30         // of your own rounds shown in progress view
};
