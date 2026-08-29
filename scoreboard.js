/* ------------------------------------------------------------------
   Synonym Ladder - scoreboard
   Builds a round record, keeps it locally, and hands it to a remote
   driver when one has registered itself (see cloud.js).

   The record builder is pure so it can be tested in Node, and the local
   driver takes its storage as an argument for the same reason.
   ------------------------------------------------------------------ */
(function (root) {
  'use strict';

  var STORE_ROUNDS = 'synonym-ladder:rounds';
  var STORE_IDENTITY = 'synonym-ladder:identity';

  // ---------- record ------------------------------------------------

  /* Every number the Play group of the metrics panel shows, plus what is
     needed to identify and later re-verify the round. */
  function buildRecord(input) {
    var m = input.metrics;
    var counts = m.topology.rungWidths;
    return {
      id: input.id || randomId(),
      played_at: input.playedAt || new Date().toISOString(),
      played_on: (input.playedAt || new Date().toISOString()).slice(0, 10),
      app_version: input.appVersion || null,

      seed: input.seed,
      tier: input.tier,
      mode: input.mode,
      reason: input.reason || null,

      // --- play metrics ---
      score: m.score,
      raw_score: m.rawScore,
      penalty: m.penalty,
      entries: m.guesses,
      entry_limit: m.guessLimit,
      entries_left: m.guessesLeft,
      hit_rate: m.hitRate,
      points_per_entry: m.pointsPerEntry,
      roots_set_aside: m.rootsSetAside,
      click_aways: input.clickAways || 0,
      away_seconds: input.awaySeconds || 0,
      seconds: input.seconds || 0,

      // --- board shape ---
      words: input.found.length,
      rung1: counts[1] || 0,
      rung2: counts[2] || 0,
      rung3: counts[3] || 0,
      rung4: counts[4] || 0,

      // --- payload kept so a round can be re-checked later ---
      found: input.found.map(function (e) {
        return { word: e.word, depth: e.depth, parent: e.parent, quality: e.quality };
      }),
      tries: (input.tries || []).map(function (t) {
        return { word: t.word, reason: t.reason, resolved: !!t.resolved };
      })
    };
  }

  function randomId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* A round is worth keeping if the player actually played it. */
  function isWorthKeeping(record) {
    return !!record && record.entries > 0;
  }

  // ---------- local driver -----------------------------------------

  function createLocalDriver(storage) {
    function read(key, fallback) {
      try {
        var raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    }
    function write(key, value) {
      try { storage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    }

    function identity() {
      var saved = read(STORE_IDENTITY, null);
      if (saved && saved.username) return saved;
      var fresh = {
        username: 'player-' + Math.random().toString(36).slice(2, 6),
        source: 'local',
        signedIn: false
      };
      write(STORE_IDENTITY, fresh);
      return fresh;
    }

    function setUsername(name) {
      var id = identity();
      id.username = name;
      write(STORE_IDENTITY, id);
      return Promise.resolve(id);
    }

    function rounds() {
      var list = read(STORE_ROUNDS, []);
      return Array.isArray(list) ? list : [];
    }

    return {
      name: 'local',
      identity: identity,
      setUsername: setUsername,

      save: function (record, opts) {
        var list = rounds();
        record.username = identity().username;
        // pending means "not yet in the cloud" - flushed on the next sign-in
        record.pending = !!(opts && opts.pending);
        list.unshift(record);
        write(STORE_ROUNDS, list.slice(0, 500));
        return Promise.resolve({ stored: 'local', record: record });
      },

      markSynced: function (ids) {
        var list = rounds().map(function (r) {
          if (ids.indexOf(r.id) !== -1) r.pending = false;
          return r;
        });
        write(STORE_ROUNDS, list);
      },

      pending: function () {
        return rounds().filter(function (r) { return r.pending; });
      },

      /* Best round per player per tier - the same shape the SQL view returns,
         so the UI does not care which driver answered. */
      topByTier: function (tier, limit) {
        var best = {};
        rounds().filter(function (r) { return r.tier === tier; }).forEach(function (r) {
          var key = r.username || 'you';
          if (!best[key] || r.score > best[key].score ||
              (r.score === best[key].score && r.seconds < best[key].seconds)) best[key] = r;
        });
        var list = Object.keys(best).map(function (k) { return best[k]; })
          .sort(function (a, b) { return b.score - a.score || a.seconds - b.seconds; });
        return Promise.resolve(list.slice(0, limit || 25));
      },

      myRounds: function (limit) {
        var me = identity().username;
        var list = rounds().filter(function (r) { return !r.username || r.username === me; });
        return Promise.resolve(list.slice(0, limit || 30));
      }
    };
  }

  // ---------- facade ------------------------------------------------

  function createScoreboard(options) {
    options = options || {};
    var local = options.local;
    var remote = null;
    var listeners = [];

    // Reads prefer the shared board; a signed-out visitor still sees it.
    function active() { return remote || local; }

    /* Who the player is: the cloud only speaks for them once there is a
       session, otherwise the local name stands. */
    function whoDriver() {
      if (remote) {
        var id = remote.identity();
        if (id && id.signedIn) return remote;
      }
      return local;
    }

    function notify() {
      listeners.forEach(function (fn) {
        try { fn(); } catch (e) {}
      });
    }

    function useRemote(driver) {
      remote = driver;
      notify();
      if (driver) flush();
    }

    /* Rounds played while offline or signed out are uploaded once a real
       session exists, so practice is never lost. */
    function flush() {
      if (!remote || !local.pending) return Promise.resolve(0);
      var waiting = local.pending();
      if (!waiting.length) return Promise.resolve(0);
      return waiting.reduce(function (chain, record) {
        return chain.then(function (done) {
          return remote.save(record).then(function () { return done.concat([record.id]); },
                                          function () { return done; });
        });
      }, Promise.resolve([])).then(function (synced) {
        if (synced.length) {
          local.markSynced(synced);
          notify();
        }
        return synced.length;
      });
    }

    return {
      buildRecord: buildRecord,
      isWorthKeeping: isWorthKeeping,
      useRemote: useRemote,
      hasRemote: function () { return !!remote; },
      identity: function () { return whoDriver().identity(); },
      setUsername: function (name) {
        return whoDriver().setUsername(name).then(function (id) { notify(); return id; });
      },
      remoteIdentity: function () { return remote ? remote.identity() : null; },
      signIn: function (how) {
        if (!remote) {
          // Name the actual cause - "not configured" sent someone hunting
          // through Supabase when the answer was an empty config.js.
          return Promise.reject(new Error(options.cloudConfigured
            ? 'the scoreboard service did not finish loading — check the browser console'
            : 'config.js has no supabaseUrl / supabaseAnonKey, so there is nothing to sign in to'));
        }
        return how === 'google' ? remote.signInWithGoogle() : remote.signInAnonymously();
      },
      signOut: function () {
        return remote ? remote.signOut() : Promise.resolve();
      },

      save: function (record) {
        if (!isWorthKeeping(record)) return Promise.resolve({ stored: 'skipped' });
        record.username = whoDriver().identity().username;
        if (!remote) {
          // keep it, and mark it for upload if a cloud is configured at all
          return local.save(record, { pending: !!options.cloudConfigured }).then(function (r) {
            notify();
            return r;
          });
        }
        return remote.save(record).then(function () {
          return local.save(record, { pending: false }).then(function () {
            notify();
            return { stored: 'cloud', record: record };
          });
        }, function (err) {
          return local.save(record, { pending: true }).then(function () {
            notify();
            return { stored: 'local', error: err && err.message, record: record };
          });
        });
      },

      topByTier: function (tier, limit) { return active().topByTier(tier, limit); },
      myRounds: function (limit) { return active().myRounds(limit); },
      flush: flush,
      onChange: function (fn) { listeners.push(fn); },
      driverName: function () { return active().name; }
    };
  }

  var api = {
    buildRecord: buildRecord,
    isWorthKeeping: isWorthKeeping,
    createLocalDriver: createLocalDriver,
    createScoreboard: createScoreboard,
    STORE_ROUNDS: STORE_ROUNDS,
    STORE_IDENTITY: STORE_IDENTITY
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SLScoreboard = api;
})(typeof window !== 'undefined' ? window : globalThis);
