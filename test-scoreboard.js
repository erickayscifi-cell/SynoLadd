/* Scoreboard tests: node test-scoreboard.js
   Covers the record builder, the local driver, and the failover behaviour
   between local and cloud. No network, no browser. */

var SB = require('./scoreboard.js');

var pass = 0, fail = 0;
function check(label, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n         got ' + a + '\n         want ' + e); }
}

function fakeStorage() {
  var mem = {};
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; },
    _dump: function () { return mem; }
  };
}

function metricsFixture(over) {
  return Object.assign({
    score: 46, rawScore: 51, penalty: 5,
    guesses: 14, guessLimit: 20, guessesLeft: 6,
    hitRate: 0.64, pointsPerEntry: 3.29, rootsSetAside: 2,
    topology: { rungWidths: { 1: 5, 2: 2, 3: 1, 4: 1 } }
  }, over || {});
}

function roundInput(over) {
  return Object.assign({
    metrics: metricsFixture(),
    found: [
      { word: 'contact', depth: 1, parent: 'touch', quality: 'strong' },
      { word: 'feel', depth: 1, parent: 'touch', quality: 'loose' },
      { word: 'caress', depth: 1, parent: 'touch', quality: 'loose' },
      { word: 'cuddle', depth: 1, parent: 'touch', quality: 'loose' },
      { word: 'grope', depth: 1, parent: 'touch', quality: 'loose' },
      { word: 'fondle', depth: 2, parent: 'caress', quality: 'loose' },
      { word: 'dandle', depth: 2, parent: 'cuddle', quality: 'loose' },
      { word: 'jiggle', depth: 3, parent: 'dandle', quality: 'loose' },
      { word: 'wobble', depth: 4, parent: 'jiggle', quality: 'loose' }
    ],
    tries: [{ word: 'banana', reason: 'miss', resolved: false },
            { word: 'wobble', reason: 'miss', resolved: true }],
    seed: 'touch', tier: 'easy', mode: 'practice', reason: 'limit',
    seconds: 884, clickAways: 3, awaySeconds: 42,
    appVersion: '0.5',
    playedAt: '2026-03-16T10:00:00.000Z',
    id: 'round-1'
  }, over || {});
}

console.log('record builder');
var record = SB.buildRecord(roundInput());
check('carries every play metric', {
  score: record.score, raw: record.raw_score, penalty: record.penalty,
  entries: record.entries, limit: record.entry_limit, left: record.entries_left,
  hit: record.hit_rate, ppe: record.points_per_entry, roots: record.roots_set_aside,
  aways: record.click_aways, away_s: record.away_seconds, seconds: record.seconds
}, {
  score: 46, raw: 51, penalty: 5, entries: 14, limit: 20, left: 6,
  hit: 0.64, ppe: 3.29, roots: 2, aways: 3, away_s: 42, seconds: 884
});
check('records the round identity', {
  seed: record.seed, tier: record.tier, mode: record.mode,
  reason: record.reason, version: record.app_version
}, { seed: 'touch', tier: 'easy', mode: 'practice', reason: 'limit', version: '0.5' });
check('derives the played-on date', record.played_on, '2026-03-16');
check('counts words and rungs', [record.words, record.rung1, record.rung2, record.rung3, record.rung4],
  [9, 5, 2, 1, 1]);
check('rungs sum to words (the DB constraint)',
  record.rung1 + record.rung2 + record.rung3 + record.rung4, record.words);
check('score equals raw minus penalty (the DB constraint)',
  record.raw_score - record.penalty, record.score);
check('keeps the word payload for later verification',
  record.found.length + ':' + record.found[0].word + '/' + record.found[0].parent, '9:contact/touch');
check('keeps the tries payload', record.tries.map(function (t) { return t.word; }), ['banana', 'wobble']);
check('keeps the whole metrics blob for the detail view',
  [!!record.metrics, record.metrics.topology.rungWidths[1], record.metrics.hitRate],
  [true, 5, 0.64]);
check('an unplayed round is not worth keeping',
  SB.isWorthKeeping(SB.buildRecord(roundInput({ metrics: metricsFixture({ guesses: 0 }) }))), false);
check('a played round is worth keeping', SB.isWorthKeeping(record), true);

console.log('\nlocal driver');
var storage = fakeStorage();
var local = SB.createLocalDriver(storage);
var name = local.identity().username;
check('invents a browser-local name on first run', /^guest-[a-z0-9]{4}$/.test(name), true);
check('keeps that name', local.identity().username, name);

local.setUsername('kris').then(function () {
  check('name can be changed', local.identity().username, 'kris');

  var a = SB.buildRecord(roundInput({ id: 'r-a' }));
  var b = SB.buildRecord(roundInput({ id: 'r-b', metrics: metricsFixture({ score: 70 }) }));
  var c = SB.buildRecord(roundInput({ id: 'r-c', tier: 'hard', metrics: metricsFixture({ score: 30 }) }));

  return local.save(a).then(function () { return local.save(b); }).then(function () { return local.save(c); });
}).then(function () {
  return local.topByTier('easy', 10);
}).then(function (rows) {
  check('board keeps only a player’s best round per tier', rows.length, 1);
  check('and it is the best one', rows[0].score, 70);
  return local.topByTier('hard', 10);
}).then(function (rows) {
  check('tiers are separate boards', [rows.length, rows[0].score], [1, 30]);
  return local.myRounds(10);
}).then(function (rows) {
  check('personal history keeps every round, newest first',
    rows.map(function (r) { return r.id; }), ['r-c', 'r-b', 'r-a']);
})

// ---- the daily board's gate ---------------------------------------
/* The rule the whole feature rests on: no round today, no board. It is
   enforced in SQL as well (supabase-daily.sql) — this covers the local
   driver, which is what a signed-out player is actually reading. */
.then(function () {
  console.log('\ndaily board');
  var d = SB.createLocalDriver(fakeStorage());
  return d.dailyBoard(25, '2026-03-16').then(function (board) {
    check('shut before you have played', [board.played, board.reason, board.rows.length],
      [false, 'not-played', 0]);

    // a practice round today must not open it
    return d.save(SB.buildRecord(roundInput({ id: 'r-prac', mode: 'practice' })))
      .then(function () { return d.dailyBoard(25, '2026-03-16'); });
  }).then(function (board) {
    check('a practice round is not a daily round', board.played, false);

    return d.save(SB.buildRecord(roundInput({
      id: 'r-daily', mode: 'daily', playedAt: '2026-03-16T09:00:00.000Z'
    }))).then(function () { return d.dailyBoard(25, '2026-03-16'); });
  }).then(function (board) {
    check('opens once today’s daily is filed', [board.played, board.rows.length], [true, 1]);
    check('marked local, so the page can explain the board of one', board.local, true);
    check('your row is yours', [board.rows[0].place, board.rows[0].mine, board.you], [1, true, 1]);
    check('carries no seed word — you know it, and nobody else should',
      board.rows[0].seed === undefined, true);

    // a second attempt must not displace the first
    return d.save(SB.buildRecord(roundInput({
      id: 'r-daily-2', mode: 'daily', playedAt: '2026-03-16T21:00:00.000Z',
      metrics: metricsFixture({ score: 99 })
    }))).then(function () { return d.dailyBoard(25, '2026-03-16'); });
  }).then(function (board) {
    check('the first attempt stands, not the best', [board.rows.length, board.rows[0].score], [1, 46]);
    return d.dailyBoard(25, '2026-03-17');
  }).then(function (board) {
    check('yesterday’s round does not open today', board.played, false);
  });
})

// ---- failover: cloud configured but unreachable -------------------
.then(function () {
  console.log('\nfailover');
  var sb = SB.createScoreboard({
    local: SB.createLocalDriver(fakeStorage()),
    cloudConfigured: true
  });
  return sb.save(SB.buildRecord(roundInput({ id: 'r-offline' }))).then(function (result) {
    check('with no driver registered the round is kept locally', result.stored, 'local');
    check('and marked pending for upload', result.record.pending, true);
    return sb;
  });
})
.then(function (sb) {
  var uploaded = [];
  var remote = {
    name: 'fake-cloud',
    identity: function () { return { username: 'kris', source: 'google', signedIn: true }; },
    setUsername: function () { return Promise.resolve({ username: 'kris' }); },
    save: function (r) { uploaded.push(r.id); return Promise.resolve({ stored: 'cloud' }); },
    topByTier: function () { return Promise.resolve([{ username: 'kris', score: 99, tier: 'easy' }]); },
    myRounds: function () { return Promise.resolve([]); }
  };
  sb.useRemote(remote);
  // useRemote triggers a flush; give the promise chain a tick to settle
  return new Promise(function (resolve) { setTimeout(resolve, 0); }).then(function () {
    check('registering a driver uploads the pending round', uploaded, ['r-offline']);
    check('identity now comes from the cloud', sb.identity().username, 'kris');
    check('reads go to the cloud', sb.driverName(), 'fake-cloud');
    return sb.topByTier('easy', 5);
  }).then(function (rows) {
    check('board rows come back from the driver', rows[0].score, 99);
    return sb;
  });
})
.then(function (sb) {
  var remote = {
    name: 'broken-cloud',
    identity: function () { return { username: 'kris', source: 'google', signedIn: true }; },
    setUsername: function () { return Promise.resolve({ username: 'kris' }); },
    save: function () { return Promise.reject(new Error('network down')); },
    topByTier: function () { return Promise.resolve([]); },
    myRounds: function () { return Promise.resolve([]); }
  };
  sb.useRemote(remote);
  return sb.save(SB.buildRecord(roundInput({ id: 'r-during-outage' })));
})
.then(function (result) {
  check('a failed upload still keeps the round', result.stored, 'local');
  check('and reports why', result.error, 'network down');
  check('and leaves it pending', result.record.pending, true);
})
/* Signed out, with a cloud driver registered: personal history must still
   come from this browser. Reading it from the cloud returned an empty list
   and hid rounds that were saved locally all along. */
.then(function () {
  console.log('\nsigned out, cloud present');
  var sb = SB.createScoreboard({
    local: SB.createLocalDriver(fakeStorage()),
    cloudConfigured: true
  });
  var signedOutRemote = {
    name: 'cloud-signed-out',
    identity: function () { return { username: null, source: 'none', signedIn: false }; },
    setUsername: function () { return Promise.reject(new Error('not signed in')); },
    save: function () { return Promise.reject(new Error('not signed in')); },
    topByTier: function () { return Promise.resolve([{ username: 'someone', score: 99 }]); },
    myRounds: function () { return Promise.resolve([]); }   // the cloud knows nothing about you
  };
  sb.useRemote(signedOutRemote);
  return sb.save(SB.buildRecord(roundInput({ id: 'r-practice', mode: 'practice' })))
    .then(function (r) {
      check('a practice round is kept even when signed out', r.stored, 'local');
      return sb.myRounds(10);
    })
    .then(function (rows) {
      check('your progress reads from this browser when signed out',
        rows.map(function (x) { return x.id; }), ['r-practice']);
      return sb.topByTier('easy', 5);
    })
    .then(function (rows) {
      check('the shared board still comes from the cloud', rows[0].username, 'someone');
      return sb.save(SB.buildRecord(roundInput({
        id: 'r-daily-out', mode: 'daily', playedAt: '2026-03-16T09:00:00.000Z'
      })));
    })
    /* The daily board must follow the round, not the connection. Asking the
       server while signed out would answer "you have not played" to someone
       who just did — the round is sitting in this browser. */
    .then(function () { return sb.dailyBoard(25, '2026-03-16'); })
    .then(function (board) {
      check('the daily board reads this browser when signed out',
        [board.played, board.local, board.rows.length], [true, true, 1]);
    });
})

.then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})
.catch(function (err) {
  console.error('test crashed:', err);
  process.exit(1);
});
