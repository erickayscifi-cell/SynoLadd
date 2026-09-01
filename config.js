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
  supabaseUrl: 'https://upqcvyeehiamujmaubek.supabase.co',

  // Project Settings → API keys. Either the newer "publishable" key
  // (sb_publishable_…) or the legacy "anon public" JWT (eyJ…) works — they
  // are interchangeable here. Legacy keys are being retired through 2026,
  // so prefer the publishable one. Never the secret / service_role key.
  supabaseAnonKey: 'sb_publishable_TXKtsw8z2eNz5ZFSY62uZQ_CVvJCeM4',

  // Set true to ignore the credentials above and keep everything in the
  // browser — no accounts, no sign-in sheet, no network calls but Datamuse.
  // Useful for playtesting, or if the scoreboard is misbehaving and you
  // just want the game.
  offlineOnly: false,

  // ==================================================================
  //  BLITZ LENGTH — change this one number to retime the timed mode.
  //  150 = two and a half minutes. 120 or 90 keeps a busy queue moving;
  //  240 gives someone room to think it through.
  //  Takes effect on the next round; no other change needed anywhere.
  // ==================================================================
  blitzSeconds: 150,

  //  Confetti, emoji and the rest: 'blitz' keeps the celebration to timed
  //  rounds, 'always' turns it on everywhere, 'never' switches it off.
  //  Anyone who has asked their system for reduced motion gets the emoji
  //  without the animation, whatever this says.
  celebrate: 'blitz',

  appVersion: '0.5',      // stored with each round, so old data stays readable
  boardSize: 25,          // rows shown per leaderboard
  historySize: 30         // of your own rounds shown in progress view
};
