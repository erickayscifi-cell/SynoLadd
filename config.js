/* ------------------------------------------------------------------
   Deployment settings. Everything here is safe to publish: the anon key
   is designed to sit in a browser, and Row Level Security in the database
   is what actually decides who may write. Never paste a service_role key
   into this file.

   Leave the two Supabase values empty and the game runs exactly as before,
   with the scoreboard kept in each player's own browser.
   ------------------------------------------------------------------ */

window.SL_CONFIG = {
  supabaseUrl: '',        // e.g. 'https://abcdefgh.supabase.co'
  supabaseAnonKey: '',    // the "anon public" key from Project Settings → API

  appVersion: '0.5',      // stored with each round, so old data stays readable
  boardSize: 25,          // rows shown per leaderboard
  historySize: 30         // of your own rounds shown in progress view
};
