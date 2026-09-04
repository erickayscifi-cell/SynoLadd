/* ------------------------------------------------------------------
   Synonym Ladder - UI layer
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  var SL = window.SynonymLadder;
  var SB = window.SLScoreboard;
  var CFG = window.SL_CONFIG || {};
  var WORDS = window.WORDS;
  var TIER_BY_WEEKDAY = window.DAILY_TIER_BY_WEEKDAY;
  var TIER_LABELS = window.TIER_LABELS || {};
  var TIER_ALIASES = window.TIER_ALIASES || {};
  var ORDINALS = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
  var STORE_PREFIX = 'synonym-ladder:';

  /* One script, two pages. index.html plays; scoreboard.html shows the
     boards. Both need the same identity handling and the same metrics
     renderer, so they share this file rather than duplicating it, and each
     page runs only the part it has markup for. */
  var PAGE = (document.body && document.body.dataset.page) || 'game';

  var el = {
    seed: byId('seed'),
    seedLabel: byId('seed-label'),
    score: byId('stat-score'),
    words: byId('stat-words'),
    triesStat: byId('stat-tries'),
    left: byId('stat-left'),
    time: byId('stat-time'),
    triesBlock: byId('tries-block'),
    triesList: byId('tries-list'),
    triesCost: byId('tries-cost'),
    rootsBlock: byId('roots-block'),
    rootsList: byId('roots-list'),
    form: byId('guess-form'),
    guess: byId('guess'),
    submit: byId('submit'),
    message: byId('message'),
    body: byId('board-body'),
    tierPicker: byId('tier-picker'),
    newWord: byId('btn-new'),
    finish: byId('btn-finish'),
    rulesBtn: byId('btn-rules'),
    rules: byId('rules'),
    rulesClose: byId('btn-rules-close'),
    metricsBtn: byId('btn-metrics'),
    metrics: byId('metrics'),
    metricsClose: byId('btn-metrics-close'),
    metricGroups: byId('metric-groups'),
    hist: byId('hist'),
    who: byId('btn-who'),
    signInBtn: byId('btn-signin'),
    sheet: byId('signin-sheet'),
    sheetClose: byId('btn-signin-close'),
    sheetNote: byId('signin-note'),
    google: byId('btn-google'),
    anon: byId('btn-anon'),
    board: byId('board'),
    boardWhere: byId('board-where'),
    boardTabs: byId('board-tabs'),
    boardThead: byId('board-thead'),
    boardTbody: byId('board-tbody'),
    track: byId('entry-track'),
    boardNote: byId('board-note'),
    runDetail: byId('run-detail'),
    runTitle: byId('run-title'),
    runWords: byId('run-words'),
    runGroups: byId('run-groups'),
    runHist: byId('run-hist'),
    runClose: byId('btn-run-close'),
    rename: byId('btn-rename'),
    signOut: byId('btn-signout'),
    linkGoogle: byId('btn-link-google'),
    deleteAccount: byId('btn-delete'),
    accountNote: byId('account-note'),
    summary: byId('summary'),
    summaryTitle: byId('summary-title'),
    overReason: byId('over-reason'),
    overFlag: byId('over-flag'),
    summaryGrid: byId('summary-grid'),
    summaryMissed: byId('summary-missed'),
    copy: byId('btn-copy'),
    again: byId('btn-again'),
    // today's daily board, game page only
    dailyBoard: byId('daily-board'),
    dailyWhere: byId('daily-where'),
    dailyThead: byId('daily-thead'),
    dailyTbody: byId('daily-tbody'),
    dailyNote: byId('daily-note'),
    dailyRefresh: byId('btn-daily-refresh')
  };

  var state = {
    mode: 'daily',
    tier: 'easy',
    game: null,
    elapsed: 0,          // seconds
    started: false,      // has a word been entered yet?
    ticking: false,
    finished: false,
    reason: null,        // 'limit' | 'time' | 'stopped' | 'saved'
    countdown: 0,        // blitz only: seconds allowed, 0 means untimed
    filed: false,        // has this round been sent to the scoreboard?
    tickHandle: null,
    signInWatchdog: null,
    // window focus tracking
    away: false,
    awayCount: 0,
    awaySeconds: 0,
    awaySince: null
  };

  function byId(id) { return document.getElementById(id); }

  /* Guarded wiring. A missing optional element used to throw here and take
     the whole script down with it — one stale cached page and the game was
     a blank screen. Scoreboard chrome is optional; the game is not. */
  function on(node, event, handler) {
    if (node) node.addEventListener(event, handler);
    // Absent elements are normal now that the game and the board are
    // separate pages sharing this file, so this is debug-level rather than
    // a warning — visible when you go looking, silent otherwise.
    else if (window.console && console.debug) console.debug('[synonym ladder] no element for a ' + event + ' handler');
  }
  function show(node, visible) { if (node) node.hidden = !visible; }

  function tierName(tier) { return TIER_LABELS[tier] || tier; }

  /* Which tier a word belongs to, from the bundled lists. The database
     knows about far more words than these, so a null here means "not in
     the fallback list" rather than "not a real seed". */
  function tierOf(word) {
    var found = null;
    Object.keys(WORDS).forEach(function (tier) {
      if (!found && WORDS[tier].indexOf(word) !== -1) found = tier;
    });
    return found;
  }

  /* ---------- scoreboard ------------------------------------------------
     One facade, two drivers. Without Supabase credentials it keeps rounds
     in this browser; cloud.js registers itself when configured and the UI
     does not change shape either way. */

  var scoreboard = SB.createScoreboard({
    local: SB.createLocalDriver(safeStorage()),
    cloudConfigured: !CFG.offlineOnly && !!(CFG.supabaseUrl && CFG.supabaseAnonKey)
  });

  // published so cloud.js can find it once it loads
  window.SLGame = { scoreboard: scoreboard };

  /* cloud.js is a module and lands after this script. The daily word now
     comes from the database, so the first render waits for it — but only
     briefly: a slow CDN should cost a less-surprising word, never a
     game that will not start. */
  var cloudReady = (function () {
    if (CFG.offlineOnly || !CFG.supabaseUrl || !CFG.supabaseAnonKey) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var settled = false;
      function finish(ok) { if (!settled) { settled = true; resolve(ok); } }
      scoreboard.onChange(function () { if (scoreboard.hasRemote()) finish(true); });
      if (scoreboard.hasRemote()) finish(true);
      setTimeout(function () { finish(false); }, 3000);
    });
  })();

  function safeStorage() {
    try {
      window.localStorage.setItem('synonym-ladder:probe', '1');
      window.localStorage.removeItem('synonym-ladder:probe');
      return window.localStorage;
    } catch (e) {
      // private window, or storage blocked: keep rounds for this session only
      var mem = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
        setItem: function (k, v) { mem[k] = String(v); },
        removeItem: function (k) { delete mem[k]; }
      };
    }
  }

  // ---------- storage (best effort; private windows can throw) ------

  function load(key) {
    try {
      var raw = localStorage.getItem(STORE_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(STORE_PREFIX + key, JSON.stringify(value)); } catch (e) {}
  }

  // ---------- word selection ---------------------------------------

  function todayKey() {
    return new Date().toISOString().slice(0, 10); // UTC date, same for everyone
  }

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  }

  function dailyPuzzle() {
    var key = todayKey();
    var weekday = new Date(key + 'T00:00:00Z').getUTCDay();
    var tier = TIER_BY_WEEKDAY[weekday] || 'medium';
    var list = WORDS[tier];
    return { key: key, tier: tier, word: list[hash(key + tier) % list.length] };
  }

  /* ---------- choosing a seed -------------------------------------------
     With Supabase configured the words come from a table the client cannot
     read, one at a time. Without it, from the fallback list in words.js.
     Either way the last dozen are avoided: a 16-word pool drawn WITH
     replacement is what made practice feel repetitive, not bad randomness. */

  var RECENT_KEPT = 12;

  function recentSeeds(tier) {
    var list = load('recent:' + tier);
    return Array.isArray(list) ? list : [];
  }

  function rememberSeed(tier, word) {
    var list = recentSeeds(tier).filter(function (w) { return w !== word; });
    list.unshift(word);
    save('recent:' + tier, list.slice(0, RECENT_KEPT));
  }

  // crypto randomness, not a fingerprint: a fingerprint is stable per
  // browser, which would make draws more correlated, not less.
  function randomIndex(n) {
    if (n <= 0) return 0;
    if (window.crypto && window.crypto.getRandomValues) {
      var a = new Uint32Array(1);
      window.crypto.getRandomValues(a);
      return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function randomWord(tier, avoid) {
    var recent = recentSeeds(tier).concat(avoid ? [avoid] : []);
    var fresh = WORDS[tier].filter(function (w) { return recent.indexOf(w) === -1; });
    var list = fresh.length ? fresh : WORDS[tier];
    return list[randomIndex(list.length)];
  }

  /* Ask the database first; fall back to the bundled list on any failure,
     so a hiccup costs a less-surprising word rather than a broken game. */
  function choosePracticeWord(tier, avoid) {
    return scoreboard.practiceSeed(tier, recentSeeds(tier).concat(avoid ? [avoid] : []))
      .then(function (word) { return word || randomWord(tier, avoid); },
            function (err) {
              console.warn('[synonym ladder] practice seed lookup failed:', err && err.message);
              return randomWord(tier, avoid);
            });
  }

  function chooseDaily() {
    return scoreboard.dailySeed().then(function (pick) {
      if (pick && pick.word && WORDS[pick.tier]) return pick;
      return dailyPuzzle();
    }, function (err) {
      console.warn('[synonym ladder] daily seed lookup failed:', err && err.message);
      return dailyPuzzle();
    });
  }

  /* ---------- surprise and delight --------------------------------------
     Blitz earns a little theatre; the untimed modes stay quiet, which is
     what makes blitz feel different. config.js decides ('blitz' | 'always'
     | 'never'), and the system's reduced-motion setting overrides the
     animation regardless — confetti is the classic thing that makes some
     people ill, and a convention is exactly where you meet them. */

  var CELEBRATE = CFG.celebrate || 'blitz';
  var TOAST_LAYER = byId('toast-layer');

  function celebrating() {
    if (!TOAST_LAYER || CELEBRATE === 'never') return false;
    return CELEBRATE === 'always' || (CELEBRATE === 'blitz' && state.mode === 'blitz');
  }

  function toast(emoji, label) {
    if (!TOAST_LAYER) return;
    var node = document.createElement('div');
    node.className = 'toast';
    node.textContent = emoji;
    // a touch of scatter so repeats do not stack into one blur, but kept
    // near the middle and high on the page, beside the seed word
    node.style.left = (47 + Math.random() * 6) + '%';
    node.style.top = (11 + Math.random() * 5) + '%';
    if (label) {
      var tag = document.createElement('span');
      tag.className = 'toast-label';
      tag.textContent = label;
      node.appendChild(tag);
    }
    TOAST_LAYER.appendChild(node);
    setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 1300);
  }

  var CONFETTI_COLOURS = ['#1f6f6b', '#c08a2e', '#b5504a', '#5fc0b8', '#d8a44a', '#7a9e7e'];

  function confetti(count) {
    if (!TOAST_LAYER) return;
    // bursts from the same height as the toast, up by the seed word
    var originX = window.innerWidth / 2;
    var originY = window.innerHeight * 0.15;
    for (var i = 0; i < count; i++) {
      var bit = document.createElement('div');
      bit.className = 'confetti';
      bit.style.left = originX + 'px';
      bit.style.top = originY + 'px';
      bit.style.background = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
      bit.style.setProperty('--dx', (Math.random() * 320 - 160).toFixed(0) + 'px');
      bit.style.setProperty('--dy', (Math.random() * 200 + 90).toFixed(0) + 'px');
      bit.style.setProperty('--spin', (Math.random() * 720 - 360).toFixed(0) + 'deg');
      bit.style.animationDelay = (Math.random() * 90).toFixed(0) + 'ms';
      TOAST_LAYER.appendChild(bit);
      (function (node) {
        setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 1400);
      })(bit);
    }
  }

  /* Bigger finds get a bigger party — a first-order word is worth eight
     times a fourth-order one, and the celebration should say so. */
  var HIT_STYLE = {
    1: { emoji: '🎉', confetti: 20 },
    2: { emoji: '✨', confetti: 12 },
    3: { emoji: '👏', confetti: 7 },
    4: { emoji: '🙂', confetti: 4 }
  };

  function celebrateHit(entry) {
    if (!celebrating()) return;
    var look = HIT_STYLE[entry.depth] || HIT_STYLE[4];
    toast(look.emoji, '+' + entry.points);
    confetti(look.confetti);
  }

  function celebrateMiss() {
    if (!celebrating()) return;
    toast('💨', '−1');
  }

  function celebrateClock(secondsRemaining) {
    if (!celebrating()) return;
    if (secondsRemaining === 60) toast('😅', 'one minute');
    else if (secondsRemaining === 10) toast('⏰', 'ten seconds');
  }

  /* ---------- remembering what we looked up ------------------------------
     "clear", "loud", "plain" turn up round after round, and each one used
     to cost two network calls every time. The merged answer for a word
     barely changes, so keep it: instantly in memory for this session, and
     in localStorage for the next one.

     Kept per browser rather than shared. A shared cache would need
     somewhere for clients to WRITE their results, and an open write
     endpoint is an invitation to poison "clear" for everybody. */
  var CACHE_KEY = 'words:' + (CFG.appVersion || '0') + ':';
  var CACHE_TTL = 7 * 24 * 60 * 60 * 1000;   // a week
  var CACHE_MAX = 150;                        // words kept on disk
  var memo = {};                              // this session, no parsing cost

  function cacheGet(word) {
    if (memo[word]) return memo[word];
    var hit = load(CACHE_KEY + word);
    if (!hit || !hit.at || !hit.map) return null;
    if (Date.now() - hit.at > CACHE_TTL) return null;
    memo[word] = hit.map;
    return hit.map;
  }

  function cachePut(word, map) {
    memo[word] = map;
    save(CACHE_KEY + word, { at: Date.now(), map: map });
    // newest first, oldest evicted — otherwise a long practice streak fills
    // localStorage and every write starts failing silently
    var index = load('words-index') || [];
    index = [word].concat(index.filter(function (w) { return w !== word; }));
    while (index.length > CACHE_MAX) {
      var drop = index.pop();
      try { localStorage.removeItem(STORE_PREFIX + CACHE_KEY + drop); } catch (e) {}
    }
    save('words-index', index);
  }

  /* ---------- looking a word up -----------------------------------------
     Datamuse and Moby answer at the same time, and the results merge:
     Datamuse decides what counts as a strong link, Moby fills in the words
     it has never heard of. Both are allowed to fail — a round with one
     source is worse than a round with two, but a round with none is over. */
  function lookUpWord(word) {
    var remembered = cacheGet(word);
    if (remembered) return Promise.resolve(remembered);
    return fetchWord(word).then(function (map) {
      // only worth keeping if something came back
      if (map && Object.keys(map).length) cachePut(word, map);
      return map;
    });
  }

  function fetchWord(word) {
    var datamuse = SL.defaultFetcher(word).catch(function (err) {
      console.warn('[synonym ladder] datamuse lookup failed for "' + word + '":', err && err.message);
      return {};
    });
    var moby = scoreboard.thesaurusLinks(word).catch(function (err) {
      console.warn('[synonym ladder] thesaurus lookup failed for "' + word + '":', err && err.message);
      return null;
    });
    return Promise.all([datamuse, moby]).then(function (both) {
      return SL.mergeRelated(both[0], both[1]);
    });
  }

  // ---------- round lifecycle --------------------------------------

  function startRound(opts) {
    state.mode = opts.mode;
    state.tier = opts.tier;
    state.finished = false;
    state.started = false;
    state.reason = null;
    state.filed = false;
    // blitz is the only timed mode; CFG.blitzSeconds is the one dial
    state.countdown = opts.mode === 'blitz' ? (CFG.blitzSeconds || 240) : 0;
    state.away = false;
    state.awayCount = 0;
    state.awaySeconds = 0;
    state.awaySince = null;
    state.elapsed = opts.elapsed || 0;
    state.game = SL.createGame({ seed: opts.word, fetcher: lookUpWord });
    // so the next draw can avoid it, wherever the word came from
    rememberSeed(opts.tier, opts.word);

    el.seed.textContent = opts.word;
    el.seedLabel.textContent = opts.mode === 'daily'
      ? 'daily puzzle · ' + tierName(opts.tier) + ' · ' + todayKey()
      : opts.mode === 'blitz'
        ? 'blitz · ' + tierName(opts.tier) + ' · ' + clock(state.countdown) + ' on the clock'
        : 'practice · ' + tierName(opts.tier);
    var freeChoice = opts.mode === 'practice' || opts.mode === 'blitz';
    el.tierPicker.hidden = !freeChoice;
    el.newWord.hidden = !freeChoice;
    el.summary.hidden = true;
    show(el.dailyBoard, false);      // belongs to the round that just ended
    el.guess.value = '';
    setBusy(true);
    say('Loading the thesaurus for “' + opts.word + '”…');

    document.querySelectorAll('[data-mode]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === opts.mode);
    });
    document.querySelectorAll('[data-tier]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tier === opts.tier);
    });

    var saved = opts.mode === 'daily' ? load('daily:' + todayKey()) : null;
    var hasSaved = saved && saved.seed === opts.word &&
                   ((saved.found && saved.found.length) ||
                    (saved.tries && saved.tries.length) ||
                    (saved.roots && saved.roots.length));

    state.game.start().then(function () {
      if (hasSaved) {
        return state.game.restore(saved.found, saved.tries, saved.roots, saved.log).then(function () {
          state.elapsed = saved.elapsed || 0;
          state.awayCount = saved.awayCount || 0;
          state.awaySeconds = saved.awaySeconds || 0;
          state.started = true;
          if (saved.finished) return finishRound(true, saved.reason || 'saved');
          say('Picked up where you left off.');
        });
      }
      say(opts.mode === 'daily'
        ? 'One word a day, same for everyone. Go wide before you go deep.'
        : 'Name a synonym of “' + opts.word + '”.');
    }).catch(function (err) {
      say('Could not reach the thesaurus: ' + err.message, 'no');
    }).then(function () {
      setBusy(state.finished);   // a daily already finished stays locked
      render();
      // The clock is not running yet - it starts on the first word entered.
      if (!state.finished) el.guess.focus();
    });
  }

  function startTimer() {
    if (state.ticking) return;
    state.ticking = true;
    state.tickHandle = setInterval(function () {
      state.elapsed++;
      paintClock();
      if (state.countdown) celebrateClock(state.countdown - state.elapsed);
      // whichever runs out first — the clock or the entries — ends the round
      if (state.countdown && state.elapsed >= state.countdown) {
        finishRound(false, 'time');
        return;
      }
      if (state.elapsed % 10 === 0) persist();
      // syllable / frequency data lands a moment after a word does
      if (!el.metrics.hidden && state.elapsed % 2 === 0) renderMetrics();
    }, 1000);
  }

  function stopTimer() {
    state.ticking = false;
    clearInterval(state.tickHandle);
  }

  function clock(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* Blitz counts down, everything else counts up. One function so the
     tick and a full re-render can never disagree about the clock. */
  function secondsLeft() {
    return state.countdown ? Math.max(state.countdown - state.elapsed, 0) : null;
  }

  function paintClock() {
    if (!el.time) return;
    var left = secondsLeft();
    el.time.textContent = clock(left === null ? state.elapsed : left);
    el.time.classList.toggle('miss', left !== null && left <= 30);
  }

  function persist() {
    if (state.mode !== 'daily' || !state.game) return;
    save('daily:' + todayKey(), {
      seed: state.game.seed,
      found: state.game.found(),
      tries: state.game.tries(),
      roots: state.game.roots(),
      log: state.game.log(),
      elapsed: state.elapsed,
      finished: state.finished,
      reason: state.reason,
      awayCount: state.awayCount,
      awaySeconds: state.awaySeconds
    });
  }

  // ---------- guessing --------------------------------------------

  function setBusy(busy) {
    el.submit.disabled = busy;
    el.guess.disabled = busy;
  }

  function say(text, kind) {
    el.message.textContent = text;
    el.message.className = 'message' + (kind ? ' ' + kind : '');
  }

  on(el.form, 'submit', function (e) {
    e.preventDefault();
    if (!state.game || state.finished) return;
    var raw = el.guess.value;
    if (!raw.trim()) return;

    // The clock starts on the first word entered, hit or miss.
    if (!state.started) {
      state.started = true;
      startTimer();
    }

    var before = depthMap();

    setBusy(true);
    state.game.submit(raw).then(function (result) {
      if (result.status === 'accepted') {
        var entry = result.entry;
        el.guess.value = '';
        var note = '“' + entry.word + '” — ' + ORDINALS[entry.depth] + ' order from “' +
                   entry.parent + '” · +' + entry.points +
                   (entry.quality === 'loose' ? ' (loose link)' : '');
        if (result.resolvedTry) note += ' · off the tries list';
        var moved = promoted(before);
        if (moved.length) {
          note += ' · shorter trace for ' + moved.join(', ');
        }
        say(note + left(result), 'ok');
        celebrateHit(entry);
        render(entry.word);
      } else if (result.status === 'rejected') {
        // Links to nothing: onto the red list, -1.
        el.guess.value = '';
        say(result.message + ' −' + result.item.cost + left(result), 'no');
        celebrateMiss();
        render();
      } else if (result.status === 'root') {
        // Same root as something in play: neutral, costs nothing.
        el.guess.value = '';
        say(result.message, 'neutral');
        render();
      } else {
        /* Empty input, a phrase, a duplicate, a failed lookup — or a RETRY
           of a word already on the tries list. That last one costs no
           points but does spend an entry, and this branch used to skip
           render(), so the counter sat one too high until the next move
           and the round ended with "1 entry left" showing. */
        say(result.message + left(result), 'no');
        el.guess.select();
        render();
      }
      persist();
      if (result.over) finishRound(false, 'limit');
    }).then(function () {
      setBusy(state.finished);
      if (!state.finished) el.guess.focus();
    });
  });

  /* Only mention the count when it starts to matter. */
  function left(result) {
    if (typeof result.left !== 'number') return '';
    if (result.left === 0) return '';
    if (result.left > 8) return '';
    return ' · ' + result.left + ' entr' + (result.left === 1 ? 'y' : 'ies') + ' left';
  }

  // ---------- rendering -------------------------------------------

  function render(highlight) {
    var found = state.game ? state.game.found() : [];
    var columns = [[], [], [], []];
    found.forEach(function (e) { columns[e.depth - 1].push(e); });

    var rows = Math.max.apply(null, columns.map(function (c) { return c.length; }).concat([0]));
    el.body.innerHTML = '';

    if (rows === 0) {
      var tr = document.createElement('tr');
      var td = document.createElement('td');
      td.className = 'empty';
      td.colSpan = 4;
      td.textContent = 'Nothing on the board yet.';
      tr.appendChild(td);
      el.body.appendChild(tr);
    } else {
      for (var r = 0; r < rows; r++) {
        var row = document.createElement('tr');
        for (var c = 0; c < 4; c++) {
          var cell = document.createElement('td');
          var entry = columns[c][r];
          if (entry) cell.appendChild(cellContent(entry, highlight));
          row.appendChild(cell);
        }
        el.body.appendChild(row);
      }
    }

    var counts = state.game ? state.game.counts() : { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (var d = 1; d <= 4; d++) {
      var slot = document.querySelector('[data-count="' + d + '"]');
      if (slot) slot.textContent = counts[d] + (counts[d] === 1 ? ' word' : ' words');
    }
    renderTrack();
    el.score.textContent = state.game ? state.game.score() : 0;
    el.words.textContent = found.length;
    var remaining = state.game ? state.game.guessesLeft() : 0;
    el.left.textContent = remaining;
    el.left.classList.toggle('miss', remaining <= 5);
    paintClock();
    renderTries();
    renderMetrics();
  }

  /* One bar per entry the round allows, filled in as they are spent:
     blue landed, red missed, grey a retry that cost an entry but no points.
     Same-root words and duplicates never appear — they cost nothing, so
     showing them would misrepresent what is left. */
  function renderTrack() {
    if (!el.track || !state.game) return;
    var marks = state.game.log();
    var limit = state.game.config.guessLimit;

    // build the strip once, then only repaint what changed
    if (el.track.childNodes.length !== limit) {
      el.track.innerHTML = '';
      for (var i = 0; i < limit; i++) {
        el.track.appendChild(document.createElement('span'));
      }
    }
    for (var j = 0; j < limit; j++) {
      el.track.childNodes[j].className = 'pip' + (marks[j] ? ' ' + marks[j] : '');
    }
  }

  function renderTries() {
    var tries = state.game ? state.game.tries() : [];
    var cost = state.game ? state.game.penalty() : 0;
    el.triesStat.textContent = tries.length ? '−' + cost : '0';
    el.triesBlock.hidden = tries.length === 0;
    el.triesCost.textContent = tries.length
      ? '−' + cost + ' point' + (cost === 1 ? '' : 's')
      : '';
    el.triesList.innerHTML = '';
    tries.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t.word;
      if (t.resolved) {
        li.className = 'resolved';
        li.title = 'landed on the board later — the −1 still stands';
      } else {
        li.title = t.reason === 'variant' ? 'same root as a word on the board' : 'no link found';
      }
      el.triesList.appendChild(li);
    });
    renderRoots();
  }

  function renderRoots() {
    var roots = state.game ? state.game.roots() : [];
    el.rootsBlock.hidden = roots.length === 0;
    el.rootsList.innerHTML = '';
    roots.forEach(function (r) {
      var li = document.createElement('li');
      li.textContent = r.word;
      var from = document.createElement('span');
      from.className = 'from';
      from.textContent = '= ' + r.sameAs;
      li.appendChild(from);
      el.rootsList.appendChild(li);
    });
  }

  /* Depth snapshots, so the UI can point out traces that got shorter. */
  function depthMap() {
    var out = {};
    if (state.game) state.game.found().forEach(function (e) { out[e.word] = e.depth; });
    return out;
  }

  function promoted(before) {
    if (!state.game) return [];
    return state.game.found().filter(function (e) {
      return before[e.word] !== undefined && e.depth < before[e.word];
    }).map(function (e) { return e.word; });
  }

  function cellContent(entry, highlight) {
    var wrap = document.createElement('div');
    wrap.className = 'cell';

    var dot = document.createElement('span');
    dot.className = 'dot' + (entry.quality === 'loose' ? ' loose' : '');
    dot.title = entry.quality === 'loose' ? 'loose link' : 'strong synonym link';
    wrap.appendChild(dot);

    var word = document.createElement('span');
    word.className = 'word' + (entry.word === highlight ? ' new' : '');
    word.textContent = entry.word;
    wrap.appendChild(word);

    if (entry.depth > 1) {
      /* Every word on the rung above that links to this one. They are
         equally valid routes — the rung is the same whichever you follow —
         so listing them shows how connected the board is rather than
         implying one privileged parent. */
      var parents = (entry.parents && entry.parents.length) ? entry.parents : [entry.parent];
      var from = document.createElement('span');
      from.className = 'from';
      // Two names, then a count. Three was enough to wrap the cell.
      from.textContent = '← ' + parents.slice(0, 2).join(', ') +
        (parents.length > 2 ? ' +' + (parents.length - 2) : '');
      if (parents.length > 1) {
        from.title = parents.length + ' routes in: ' + parents.join(', ');
      }
      wrap.appendChild(from);
    }
    return wrap;
  }

  // ---------- metrics ----------------------------------------------

  function fmt(value, suffix) {
    if (value === null || value === undefined || value === '') return '—';
    return value + (suffix || '');
  }

  function renderMetrics() {
    if (!el.metrics || el.metrics.hidden || !state.game) return;
    renderMetricGroups(el.metricGroups, el.hist, state.game.metrics(), {
      awayCount: state.awayCount,
      away: state.away,
      awaySeconds: state.awaySeconds
    });
  }

  /* One renderer, two callers: the live panel during a round, and a stored
     round opened from the scoreboard. `context` carries the numbers that
     live outside the engine (click-aways). */
  function renderMetricGroups(target, histTarget, m, context) {
    if (!target || !m) return;
    context = context || {};
    var t = m.topology || {}, l = m.linguistics || {}, c = m.characters || {};
    var away = context.awayCount;

    var groups = [
      ['play', [
        ['score', m.score, 'points found, minus the tries penalty'],
        ['points found', m.rawScore, '8 / 4 / 2 / 1 by rung'],
        ['tries penalty', '−' + m.penalty, '1 for each word on the tries list'],
        ['entries spent', m.guesses + '/' + m.guessLimit,
          'words that landed and words that missed; same-root words are free'],
        ['entries left', m.guessesLeft, 'the round ends when this hits zero'],
        ['hit rate', m.hitRate, 'words that landed ÷ entries spent'],
        ['points per entry', m.pointsPerEntry, 'score ÷ entries spent'],
        ['same root, set aside', m.rootsSetAside, 'free — these never spent an entry'],
        ['click-aways', (away === undefined ? '—' : away) + (context.away ? ' (away now)' : ''),
          'times the window lost focus mid-round — another window, another tab, or the screen sleeping. It cannot see where the player went.'],
        ['time away', context.awaySeconds === undefined ? '—' : clock(context.awaySeconds),
          'counted inside the clock, not deducted from it']
      ]],
      ['graph', [
        ['nodes', t.nodes + ' (seed + ' + (t.nodes - 1) + ')', 'the seed plus every word found'],
        ['links', t.edges, 'pairs of board words the thesaurus connects'],
        ['density', t.density, '2E ÷ N(N−1) — how much of the possible wiring exists'],
        ['mean degree', t.meanDegree, 'average links per word'],
        ['busiest word', t.hub ? t.hub + ' (' + t.maxDegree + ')' : '—',
          'the most-linked word, with its link count'],
        ['links off the tree', t.extraLinks, 'links beyond each word’s shortest trace — the ones scoring ignores'],
        ['independent cycles', t.independentCycles, 'E − N + 1: loops in the board'],
        ['mean trace', t.meanTrace, 'average rungs from the seed'],
        ['deepest trace', t.maxTrace, 'rungs to the furthest word (4 is the cutoff)'],
        ['clustering', t.meanClustering, 'how often a word’s neighbours link to each other'],
        ['leaves', t.leaves, 'words with a single link'],
        ['rung widths', [1, 2, 3, 4].map(function (d) { return t.rungWidths[d]; }).join(' · '),
          'words on each rung: 1st · 2nd · 3rd · 4th'],
        ['branching', [1, 2, 3].map(function (d) {
          return t.branching[d] === null ? '—' : t.branching[d];
        }).join(' · '), 'words per word on the rung before: 1st→2nd · 2nd→3rd · 3rd→4th']
      ]],
      ['language', [
        ['parts of speech', ['n', 'v', 'adj', 'adv'].map(function (p) {
          return p + ' ' + l.pos[p];
        }).join(' · '), 'noun · verb · adjective · adverb; a word can carry several'],
        ['distinct classes', l.posSpread, 'how many of the four appear at all'],
        ['mean syllables', fmt(l.meanSyllables), 'the dictionary’s own syllable counts'],
        ['most syllables', fmt(l.maxSyllables), 'the longest word to say, not to spell'],
        ['mean rarity', fmt(l.meanLogFreq), 'log₁₀ uses per million words of text — lower is rarer'],
        ['seed rarity', fmt(l.seedLogFreq), 'the seed word on that same scale'],
        ['rarest word', l.rarest ? l.rarest.word : '—', 'your least common word'],
        ['commonest word', l.commonest ? l.commonest.word : '—', 'your most everyday word'],
        ['data coverage', l.coverage, 'words the API returned frequency data for']
      ]],
      ['characters', [
        ['letters on the board', c.boardChars, 'every letter of every word that landed'],
        ['letters typed', c.typedChars, 'including tries and same-root words'],
        ['mean length', fmt(c.meanLength), 'letters per word on the board'],
        ['median length', fmt(c.medianLength), 'the middle word by length'],
        ['shortest', fmt(c.shortest)],
        ['longest', fmt(c.longest)],
        ['distinct initials', c.distinctInitials, 'how many different first letters'],
        ['distinct letters', c.distinctLetters + '/26', 'letters of the alphabet used at least once']
      ]]
    ];

    target.innerHTML = '';
    groups.forEach(function (group) {
      if (!group[1].length) return;
      var box = document.createElement('div');
      box.className = 'metric-group';
      var head = document.createElement('h3');
      head.className = 'metric-head';
      head.textContent = group[0];
      box.appendChild(head);
      var dl = document.createElement('dl');
      group[1].forEach(function (row) {
        var dt = document.createElement('dt');
        dt.textContent = row[0];
        if (row[2]) dt.title = row[2];
        var dd = document.createElement('dd');
        dd.textContent = fmt(row[1]);
        dl.appendChild(dt);
        dl.appendChild(dd);
      });
      box.appendChild(dl);
      target.appendChild(box);
    });

    renderHistogram(histTarget, c.histogram);
  }

  function renderHistogram(el2, hist) {
    if (!el2) return;
    var lengths = Object.keys(hist || {}).map(Number).sort(function (a, b) { return a - b; });
    el2.innerHTML = '';
    if (!lengths.length) {
      el2.textContent = '—';
      return;
    }
    var peak = Math.max.apply(null, lengths.map(function (n) { return hist[n]; }));
    for (var n = lengths[0]; n <= lengths[lengths.length - 1]; n++) {
      var count = hist[n] || 0;
      var row = document.createElement('div');
      row.className = 'hist-row';
      var label = document.createElement('span');
      label.className = 'hist-label';
      label.textContent = n;
      var track = document.createElement('span');
      track.className = 'hist-track';
      var bar = document.createElement('span');
      bar.className = 'hist-bar';
      bar.style.width = (count / peak * 100) + '%';
      track.appendChild(bar);
      var value = document.createElement('span');
      value.className = 'hist-value';
      value.textContent = count || '';
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(value);
      el2.appendChild(row);
    }
  }

  // ---------- account + scoreboard UI ------------------------------

  var boardView = 'hard';

  /* Two renders can be in flight at once — the page boots one, and cloud.js
     registering fires another through onChange. Both cleared the table
     synchronously and then appended when their own query returned, so the
     rows arrived twice. Each render takes a ticket and only the newest one
     is allowed to draw. */
  var boardRun = 0;

  function renderAccount() {
    var id = scoreboard.identity();
    var remote = scoreboard.remoteIdentity();
    if (el.who) {
      var offline = id.source === 'local';
      // Signed out should look signed out, not like a working account.
      el.who.textContent = (offline ? 'guest · ' : '') + (id.username || 'not signed in');
      el.who.classList.toggle('guest', offline);
      el.who.title = id.source === 'google' ? 'signed in with Google'
        : id.source === 'anonymous' ? 'anonymous account — this device only'
        : 'not signed in — rounds stay in this browser and never reach the scoreboard';
    }
    // Only offer sign-in when there is something to sign in to.
    var signedIn = !!(remote && remote.signedIn);
    show(el.signInBtn, scoreboard.hasRemote() && !signedIn);
    show(el.signOut, signedIn);
    // Linking is only meaningful for an anonymous account that exists.
    show(el.linkGoogle, signedIn && remote.source === 'anonymous');
    show(el.deleteAccount, signedIn);
    if (el.accountNote && signedIn) {
      el.accountNote.textContent = remote.source === 'anonymous'
        ? 'This account lives in this browser only. Linking Google keeps it — and your rounds — on other devices.'
        : 'Signed in with Google. Your email is never shown on the boards.';
    }
  }

  function boardHeaders(view) {
    if (view === 'daily') return DAILY_COLS;
    if (view === 'blitz') {
      return ['#', 'player', 'score', 'word', 'tier', '1st', 'entries', 'hit', 'time'];
    }
    return view === 'me'
      ? ['when', 'word', 'tier', 'score', '1st', 'entries', 'hit', 'pts/entry', 'away', 'time']
      : ['#', 'player', 'score', 'word', '1st', 'entries', 'hit', 'pts/entry', 'away', 'time'];
  }

  /* Click-aways shown plainly: a count, and how long in total. Deliberately
     not styled as an accusation — see the note under the table. */
  function awayCell(row) {
    var n = row.click_aways;
    if (n === null || n === undefined) return '—';
    if (!n) return '0';
    return n + (row.away_seconds ? ' · ' + clock(row.away_seconds) : '');
  }

  function renderBoard() {
    if (!el.board || el.board.hidden) return;
    /* Say plainly which store is being read. "Shared board" while signed
       out was misleading: the tier boards were shared, but your own rounds
       were coming from this browser. */
    var remote = scoreboard.remoteIdentity();
    var signedIn = !!(remote && remote.signedIn);
    var where = boardView === 'me'
      ? (signedIn ? 'your rounds · saved to your account' : 'your rounds · this browser only')
      : boardView === 'daily'
      ? 'today · ' + todayKey()
      : (scoreboard.hasRemote() ? 'shared board' : 'this browser only');
    el.boardWhere.textContent = where + ' · ' + (scoreboard.identity().username || 'signed out');

    document.querySelectorAll('[data-board]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.board === boardView);
    });

    if (el.runDetail) el.runDetail.hidden = true;   // detail belongs to the old view
    el.boardThead.innerHTML = '';
    var head = document.createElement('tr');
    boardHeaders(boardView).forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    });
    el.boardThead.appendChild(head);
    el.boardTbody.innerHTML = '';
    el.boardNote.textContent = 'loading…';

    var run = ++boardRun;
    /* The daily board answers with a gate as well as rows — it may decline
       to show anything at all — so keep the verdict for the note below. */
    var gate = null;
    var job = boardView === 'me'
      ? scoreboard.myRounds(CFG.historySize || 30)
      : boardView === 'blitz'
        ? scoreboard.blitzBoard(CFG.boardSize || 25)
        : boardView === 'daily'
          ? scoreboard.dailyBoard(CFG.boardSize || 25, todayKey()).then(function (board) {
              gate = board || { played: false };
              return gate.played ? (gate.rows || []) : [];
            })
          : scoreboard.topByTier(boardView, CFG.boardSize || 25);

    job.then(function (rows) {
      if (run !== boardRun) return;      // superseded while we were waiting
      el.boardTbody.innerHTML = '';      // clear again: ours are the only rows
      if (!rows.length) {
        el.boardNote.innerHTML = boardView === 'daily'
          ? (gate && gate.reason === 'signed-out'
              ? 'Sign in, play today’s word, and this board opens.'
              : 'Today’s board opens once you have finished today’s word — otherwise it ' +
                'would hand you the day’s answers. <a href="index.html">Play it now</a>.')
          : boardView === 'me'
          ? 'No finished rounds yet. A round lands here once you finish it — either by using all 20 entries or by pressing “finish round”.'
          : 'No scores on this board yet — be first.';
        return;
      }
      var me = scoreboard.identity().username;
      rows.forEach(function (r, i) {
        var tr = document.createElement('tr');
        if (r.username === me || r.mine) tr.className = 'mine';
        var cells = boardView === 'daily'
          ? [r.place, r.username, r.score, r.words, r.rung1,
             r.entries + '/' + r.entry_limit, r.hit_rate, clock(r.seconds)]
          : boardView === 'blitz'
          ? [i + 1, r.username, r.score, r.seed, tierName(r.tier), r.rung1,
             r.entries + '/' + r.entry_limit, r.hit_rate, clock(r.seconds)]
          : boardView === 'me'
          ? [(r.played_at || '').slice(0, 10), r.seed, tierName(r.tier), r.score, r.rung1,
             r.entries + '/' + r.entry_limit, r.hit_rate, r.points_per_entry,
             awayCell(r), clock(r.seconds)]
          : [i + 1, r.username, r.score, r.seed, r.rung1,
             r.entries + '/' + r.entry_limit, r.hit_rate, r.points_per_entry,
             awayCell(r), clock(r.seconds)];
        /* Daily rows carry standings only — no metrics blob, no word list,
           deliberately — so there is nothing to open. Opening one would
           also show another player's answers to a word still in play. */
        if (boardView !== 'daily') {
          tr.className += ' clickable';
          tr.title = 'open the full metrics for this round';
          tr.addEventListener('click', function () { openRun(r); });
        }
        cells.forEach(function (value, col) {
          var td = document.createElement('td');
          td.textContent = (value === null || value === undefined) ? '—' : value;
          if (col === 2 && boardView !== 'me') td.className = 'num strong';
          else if (typeof value === 'number') td.className = 'num';
          tr.appendChild(td);
        });
        el.boardTbody.appendChild(tr);
      });
      if (boardView === 'daily') {
        el.boardNote.innerHTML = gate && gate.local
          ? 'This is what this browser knows — your own round. Sign in and you join the ' +
            'shared board with everyone else who played today.'
          : 'Everyone who played today’s word, first attempt only, one row each' +
            (gate && gate.you ? ' — you are <b>#' + gate.you + '</b> of ' + gate.players : '') +
            '. Rows do not open: another player’s answers are still today’s answers. ' +
            'Tomorrow this round joins its tier board.';
        return;
      }
      el.boardNote.innerHTML = (boardView === 'blitz'
        ? 'Best timed round per player, across all tiers — a countdown makes the tiers ' +
          'comparable in a way untimed play does not.'
        : boardView === 'me'
        ? 'Every round you have finished, newest first, across all tiers. ' +
          'Watch 1st-order counts climb — that is the thesaurus recall improving.'
        : '<em>One row per player</em> — their single best round on ' + tierName(boardView) +
          ' words, so nobody can fill the board. Your other ' + tierName(boardView) +
          ' rounds are under “your progress”, and rounds on other tiers are on their own boards.') +
        ' Click any row for the full metrics. <em>Away</em> counts times the window lost focus.';
    }, function (err) {
      if (run !== boardRun) return;
      el.boardNote.textContent = 'Could not load the board: ' + err.message;
    });
  }

  /* ---------- today's daily board ---------------------------------------
     Who else played today's word. Kept off the page until the round is
     over: a board showing scores and first-order counts for a word you
     have not opened yet is a spoiler, and the seed itself would be one
     click away. The server enforces the same rule — see supabase-daily.sql
     — so this is the polite half of the gate, not the whole of it. */

  var DAILY_COLS = ['#', 'player', 'score', 'words', '1st', 'entries', 'hit', 'time'];
  var dailyRun = 0;

  function renderDailyBoard() {
    if (!el.dailyBoard) return;

    el.dailyThead.innerHTML = '';
    var head = document.createElement('tr');
    DAILY_COLS.forEach(function (label) {
      var th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    });
    el.dailyThead.appendChild(head);
    el.dailyTbody.innerHTML = '';
    el.dailyNote.textContent = 'loading…';
    el.dailyWhere.textContent = todayKey();

    // Same ticket guard as the tier boards: a refresh and an onChange can
    // be in flight together, and only the newest one may draw.
    var run = ++dailyRun;
    scoreboard.dailyBoard(CFG.boardSize || 25, todayKey()).then(function (board) {
      if (run !== dailyRun) return;
      el.dailyTbody.innerHTML = '';

      if (!board || !board.played) {
        el.dailyNote.textContent = board && board.reason === 'signed-out'
          ? 'Sign in and today’s round joins the shared board.'
          : 'This board opens once you have finished today’s word.';
        return;
      }

      (board.rows || []).forEach(function (r) {
        var tr = document.createElement('tr');
        if (r.mine) tr.className = 'mine';
        [r.place, r.username, r.score, r.words, r.rung1,
         r.entries + '/' + r.entry_limit, r.hit_rate, clock(r.seconds)
        ].forEach(function (value, col) {
          var td = document.createElement('td');
          td.textContent = (value === null || value === undefined) ? '—' : value;
          if (col === 2) td.className = 'num strong';
          else if (typeof value === 'number') td.className = 'num';
          tr.appendChild(td);
        });
        el.dailyTbody.appendChild(tr);
      });

      var players = board.players || 0;
      el.dailyWhere.textContent = todayKey() + ' · ' +
        players + (players === 1 ? ' player' : ' players');

      if (board.local) {
        /* Be plain about it. A board with one name on it looks broken
           unless you say why it has one name on it. */
        el.dailyNote.textContent =
          'This is what this browser knows — your own round. Sign in and you appear ' +
          'on the shared board with everyone else who played today.';
        return;
      }

      var note = 'Everyone who played today’s word, first attempt only, one row each.';
      if (board.you) note += ' You are #' + board.you + ' of ' + players + '.';
      if (players > (board.rows || []).length) {
        note += ' Showing the top ' + board.rows.length + '.';
      }
      note += ' The board stays shut until a player has finished the word, so it ' +
              'cannot give the day away.';
      el.dailyNote.textContent = note;
    }, function (err) {
      if (run !== dailyRun) return;
      el.dailyNote.textContent = 'Could not load today’s board: ' + err.message;
    });
  }

  /* ---------- one round, in full ----------------------------------------
     Rounds store their whole metrics blob, so opening one is instant and
     shows exactly what the player saw. Rounds filed before that existed
     get what can honestly be rebuilt from the word list: the scoring tree
     and the character stats. Graph density and language data needed the
     live thesaurus cache, so those stay blank rather than guessed at. */

  function rebuildMetrics(row) {
    var found = row.found || [];
    var lengths = found.map(function (e) { return e.word.length; });
    var hist = {};
    lengths.forEach(function (n) { hist[n] = (hist[n] || 0) + 1; });
    var sorted = lengths.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    var byLength = found.slice().sort(function (a, b) { return a.word.length - b.word.length; });
    var traces = found.map(function (e) { return e.depth; });
    var rungs = { 1: row.rung1, 2: row.rung2, 3: row.rung3, 4: row.rung4 };

    return {
      score: row.score, rawScore: row.raw_score, penalty: row.penalty,
      guesses: row.entries, guessLimit: row.entry_limit, guessesLeft: row.entries_left,
      hitRate: row.hit_rate, pointsPerEntry: row.points_per_entry,
      rootsSetAside: row.roots_set_aside,
      topology: {
        nodes: found.length + 1,
        rungWidths: rungs,
        meanTrace: traces.length
          ? +(traces.reduce(function (a, b) { return a + b; }, 0) / traces.length).toFixed(2) : 0,
        maxTrace: traces.length ? Math.max.apply(null, traces) : 0,
        branching: { 1: null, 2: null, 3: null }
      },
      linguistics: { pos: {}, coverage: 'not stored' },
      characters: {
        boardChars: lengths.reduce(function (a, b) { return a + b; }, 0),
        meanLength: lengths.length
          ? +(lengths.reduce(function (a, b) { return a + b; }, 0) / lengths.length).toFixed(2) : null,
        medianLength: sorted.length
          ? (sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : null,
        shortest: byLength.length ? byLength[0].word : null,
        longest: byLength.length ? byLength[byLength.length - 1].word : null,
        histogram: hist,
        distinctInitials: Object.keys(found.reduce(function (acc, e) {
          acc[e.word[0]] = 1; return acc;
        }, {})).length,
        distinctLetters: Object.keys(found.map(function (e) { return e.word; }).join('')
          .split('').reduce(function (acc, c) { acc[c] = 1; return acc; }, {})).length
      },
      partial: true
    };
  }

  function openRun(row) {
    if (!el.runDetail) return;
    var m = row.metrics || rebuildMetrics(row);

    el.runTitle.textContent = '“' + row.seed + '” · ' + row.score + ' points · ' +
      (row.username || 'you') + ' · ' + (row.played_at || '').slice(0, 10);

    var byRung = [1, 2, 3, 4].map(function (d) {
      var words = (row.found || []).filter(function (e) { return e.depth === d; })
                                   .map(function (e) { return e.word; });
      return words.length ? ORDINALS[d] + ': ' + words.join(', ') : null;
    }).filter(Boolean);
    var missed = (row.tries || []).filter(function (t) { return !t.resolved; })
                                  .map(function (t) { return t.word; });
    el.runWords.innerHTML = byRung.join(' &nbsp;·&nbsp; ') +
      (missed.length ? '<br><span class="run-missed">tries: ' + missed.join(', ') + '</span>' : '');

    renderMetricGroups(el.runGroups, el.runHist, m, {
      awayCount: row.click_aways,
      awaySeconds: row.away_seconds
    });

    el.runDetail.hidden = false;
    if (m.partial) {
      el.boardNote.textContent =
        'This round was filed before full metrics were stored — graph and language figures are unavailable for it.';
    }
    el.runDetail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function saveRound() {
    if (!state.game) return;
    var record = scoreboard.buildRecord({
      metrics: state.game.metrics(),
      found: state.game.found(),
      tries: state.game.tries(),
      seed: state.game.seed,
      tier: state.tier,
      mode: state.mode,
      reason: state.reason,
      seconds: state.elapsed,
      clickAways: state.awayCount,
      awaySeconds: state.awaySeconds,
      appVersion: CFG.appVersion
    });
    scoreboard.save(record).then(function (result) {
      // The game page has no board note — this used to throw here, after
      // the round had already been filed, which made a successful save look
      // like a failure in the console.
      if (el.boardNote && result.stored === 'cloud') {
        el.boardNote.textContent = 'Round filed to the scoreboard.';
      }
      if (result.stored === 'local' && scoreboard.hasRemote()) {
        say('Round saved in this browser — sign in and it will upload.', 'neutral');
      }
      renderBoard();
      // Only now: the board is gated on your round existing, so asking
      // before the save landed would be told you had not played.
      showDailyBoard();
    }).catch(function (err) {
      console.warn('[synonym ladder] could not file the round:', err && err.message);
      showDailyBoard();
    });
  }

  function askUsername() {
    var id = scoreboard.identity();
    var next = window.prompt('Scoreboard name (3–20 characters: letters, digits, - or _)',
                             id.username || '');
    if (!next) return;
    scoreboard.setUsername(next).then(function () {
      renderAccount();
      renderBoard();
    }, function (err) {
      window.alert(err.message);
    });
  }

  /* Auth is an event, not a request. The sign-in promise has proven
     unreliable to await — it can stay pending long after the session
     exists — so the UI reacts to the session appearing instead. */
  scoreboard.onChange(function () {
    renderAccount();
    renderBoard();
    /* Signing in after a daily uploads the round that was sitting in this
       browser, which turns a board of one into the real one. Redraw it. */
    if (el.dailyBoard && !el.dailyBoard.hidden) renderDailyBoard();
    var id = scoreboard.remoteIdentity();
    if (id && id.signedIn && el.sheet && !el.sheet.hidden) {
      clearTimeout(state.signInWatchdog);
      el.sheet.hidden = true;
      if (el.sheetNote) el.sheetNote.textContent = '';
    }
  });

  // The board is a page of its own now: nothing to open or close.
  document.querySelectorAll('[data-board]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      boardView = btn.dataset.board;
      renderBoard();
    });
  });
  on(el.runClose, 'click', function () { el.runDetail.hidden = true; });

  /* Worth having at a booth: rounds land while you are standing there,
     and nobody wants to reload the page mid-conversation. */
  on(el.dailyRefresh, 'click', renderDailyBoard);

  on(el.linkGoogle, 'click', function () {
    el.accountNote.textContent = 'redirecting to Google…';
    scoreboard.linkGoogle().catch(function (err) {
      el.accountNote.textContent = err.message;
    });
  });

  /* Two steps on purpose: this is the one irreversible button on the site. */
  on(el.deleteAccount, 'click', function () {
    var mine = scoreboard.identity().username;
    var ok = window.confirm(
      'Delete the account “' + mine + '”?\n\n' +
      'Your account and the name you played under are removed for good. Your rounds ' +
      'stay in the anonymous totals under a fresh random tag that cannot be traced ' +
      'back to you — they leave the boards and cannot be recovered.\n\n' +
      'This cannot be undone.');
    if (!ok) return;
    el.accountNote.textContent = 'deleting…';
    scoreboard.deleteAccount().then(function (result) {
      var n = result && result.rounds_detached;
      el.accountNote.textContent = 'Account deleted' +
        (typeof n === 'number' ? ' — ' + n + ' round' + (n === 1 ? '' : 's') + ' detached and anonymised.' : '.');
      renderAccount();
      renderBoard();
    }, function (err) {
      el.accountNote.textContent = 'Could not delete: ' + err.message;
    });
  });
  on(el.rename, 'click', askUsername);
  on(el.signOut, 'click', function () {
    scoreboard.signOut().then(function () {
      renderAccount();
      renderBoard();
      el.boardNote.textContent = 'Signed out. Rounds are kept in this browser until you sign in again.';
    });
  });
  on(el.who, 'click', function () {
    var remote = scoreboard.remoteIdentity();
    if (scoreboard.hasRemote() && !(remote && remote.signedIn)) {
      save('skip-signin', false);   // they asked for it this time
      openSheet();
    } else {
      askUsername();
    }
  });

  function openSheet() {
    if (!el.sheet) return;
    if (el.sheetNote) el.sheetNote.textContent = '';
    el.sheet.hidden = false;
  }

  /* "Play without saving" is a real choice, remembered — the sheet should
     never be a gate between someone and a word game. */
  function dismissSheet() {
    if (el.sheet) el.sheet.hidden = true;
    clearTimeout(state.signInWatchdog);
    save('skip-signin', true);
  }
  on(el.signInBtn, 'click', openSheet);
  on(el.sheetClose, 'click', dismissSheet);
  on(el.google, 'click', function () {
    el.sheetNote.textContent = 'redirecting to Google…';
    scoreboard.signIn('google').catch(function (err) {
      // A provider that is not configured fails here rather than redirecting.
      el.sheetNote.textContent = err.message;
    });
  });
  on(el.anon, 'click', function () {
    el.sheetNote.textContent = 'creating an anonymous account…';
    // The sheet is closed by the onChange handler above, when the session
    // actually arrives. Here we only report failures and impose a deadline.
    clearTimeout(state.signInWatchdog);
    state.signInWatchdog = setTimeout(function () {
      el.sheetNote.textContent =
        'no session after 12 seconds — check the browser console, then try again.';
    }, 12000);
    scoreboard.signIn('anonymous').catch(function (err) {
      clearTimeout(state.signInWatchdog);
      el.sheetNote.textContent = err.message;
    });
  });

  // ---------- finish ----------------------------------------------

  function finishRound(silent, reason) {
    if (!state.game) return;
    state.finished = true;
    state.reason = reason || state.reason || 'stopped';
    stopTimer();
    setBusy(true);
    persist();

    var counts = state.game.counts();
    var score = state.game.score();
    var best = load('best:' + state.game.seed);
    if (!best || score > best.score) {
      best = { score: score, time: state.elapsed };
      save('best:' + state.game.seed, best);
    }

    el.summaryTitle.textContent = silent
      ? 'You already played “' + state.game.seed + '” today'
      : '“' + state.game.seed + '” — ' + score + ' points';

    /* A restored daily reaches this point straight from startRound, which
       has just said "Loading the thesaurus…" and then hands over without
       speaking again — leaving that line above a finished board, reading
       as a page that never loaded.

       Cleared rather than replaced. This line narrates the last thing the
       player did, and on a refresh they have not done anything yet; the
       summary panel below is what explains a finished round. Saying
       something here would only duplicate it, and it is a live region, so
       a screen reader would read the duplicate out. */
    if (silent) say('');

    var limit = state.game.config.guessLimit;
    var why = state.reason === 'limit'
      ? 'All ' + limit + ' entries used.'
      : state.reason === 'time'
        ? 'Time up after ' + clock(state.countdown) + ' — ' +
          state.game.guesses() + ' of ' + limit + ' entries used.'
      : state.reason === 'stopped'
        ? 'You called it after ' + state.game.guesses() + ' of ' + limit + ' entries.'
        : 'Saved from an earlier session.';

    /* The moment a signed-out player has something worth keeping is the
       moment to mention that it is not being kept. */
    var remote = scoreboard.remoteIdentity();
    if (scoreboard.hasRemote() && !(remote && remote.signedIn)) {
      why += ' Kept in this browser only — sign in and this round uploads with it.';
    }
    el.overReason.textContent = why;

    el.summaryGrid.innerHTML = '';
    addStat('score', score);
    for (var d = 1; d <= 4; d++) addStat(ORDINALS[d] + ' order', counts[d]);
    addStat('tries', '−' + state.game.penalty());
    addStat('entries', state.game.guesses() + '/' + limit);
    addStat('time', clock(state.elapsed));
    addStat('best here', best.score);

    var missed = state.game.missed(10);
    el.summaryMissed.innerHTML = missed.length
      ? 'First-order words you missed: <b>' + missed.join(', ') + '</b>'
      : 'You cleared the obvious first-order words.';

    el.summary.hidden = false;
    el.overFlag.textContent = state.reason === 'limit' ? 'no entries left'
      : state.reason === 'time' ? 'time up' : 'round over';
    if (!silent) el.summary.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.metrics.hidden = false;
    el.metricsBtn.classList.add('active');
    renderMetrics();
    el.again.textContent = state.mode === 'daily' ? 'try practice mode' : 'play again';

    // A finished round is filed once; re-showing a saved daily is not a replay.
    if (!silent && !state.filed) {
      state.filed = true;
      saveRound();          // which opens the daily board once it settles
    } else {
      showDailyBoard();
    }
  }

  /* The daily board belongs to a finished daily and nothing else. Called
     from both ends of finishRound: after the round is filed, so your own
     row is on it, and immediately when re-opening a daily you already
     played, where there is nothing left to file. */
  function showDailyBoard() {
    if (!el.dailyBoard) return;
    if (state.mode !== 'daily' || !state.finished) {
      el.dailyBoard.hidden = true;
      return;
    }
    el.dailyBoard.hidden = false;
    renderDailyBoard();
  }

  function addStat(key, value) {
    var wrap = document.createElement('div');
    var v = document.createElement('span');
    v.className = 'v';
    v.textContent = value;
    var k = document.createElement('span');
    k.className = 'k';
    k.textContent = key;
    wrap.appendChild(v);
    wrap.appendChild(k);
    el.summaryGrid.appendChild(wrap);
  }

  function shareText() {
    var counts = state.game.counts();
    var lines = ['Synonym Ladder — ' + state.game.seed +
                 (state.mode === 'daily'
                   ? ' (' + tierName(state.tier) + ', ' + todayKey() + ')'
                   : ' (' + tierName(state.tier) + ')')];
    lines.push(state.game.score() + ' points · ' + state.game.found().length +
               ' words · ' + state.game.guesses() + '/' + state.game.config.guessLimit +
               ' entries · ' + clock(state.elapsed));
    for (var d = 1; d <= 4; d++) {
      if (counts[d]) lines.push(ORDINALS[d] + ' ' + '■'.repeat(Math.min(counts[d], 20)) + ' ' + counts[d]);
    }
    var misses = state.game.tries().length;
    if (misses) lines.push('tries ' + '✕'.repeat(Math.min(misses, 20)) + ' −' + state.game.penalty());
    return lines.join('\n');
  }

  // ---------- controls --------------------------------------------

  /* Every practice start goes through here: ask the database, fall back to
     the bundled list, then begin. The seed arrives asynchronously now. */
  function startPractice(tier, avoid) {
    stopTimer();
    say('Choosing a word…');
    choosePracticeWord(tier, avoid).then(function (word) {
      startRound({ mode: 'practice', tier: tier, word: word });
    });
  }

  function startDaily() {
    stopTimer();
    say('Loading today\u2019s word…');
    chooseDaily().then(function (p) {
      startRound({ mode: 'daily', tier: p.tier, word: p.word });
    });
  }

  /* Blitz: same words, same scoring, same 20 entries — but a clock running
     down. Whichever runs out first ends the round. Length lives in
     config.js as blitzSeconds. */
  function startBlitz(tier) {
    stopTimer();
    say('Choosing a word…');
    choosePracticeWord(tier).then(function (word) {
      startRound({ mode: 'blitz', tier: tier, word: word });
    });
  }

  document.querySelectorAll('[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var mode = btn.dataset.mode;
      if (mode === 'daily') startDaily();
      else if (mode === 'blitz') startBlitz(state.tier);
      else if (mode === 'practice') startPractice(state.tier);
      else {
        /* A mode the script does not know about means the markup is newer
           than this file — the usual cause is a cached app.js. Say so
           rather than quietly starting the wrong game. */
        console.warn('[synonym ladder] unknown mode "' + mode + '" — app.js looks out of date. Hard-reload (Ctrl+Shift+R).');
        say('That mode needs a newer app.js — try a hard reload (Ctrl+Shift+R).', 'no');
      }
    });
  });

  document.querySelectorAll('[data-tier]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.tier = btn.dataset.tier;
      startPractice(state.tier);
    });
  });

  on(el.newWord, 'click', function () {
    startPractice(state.tier, state.game && state.game.seed);
  });

  on(el.finish, 'click', function () { finishRound(false); });

  on(el.again, 'click', function () {
    // another go at whatever they were just playing
    if (state.mode === 'blitz') startBlitz(state.tier);
    else startPractice(state.tier, state.game && state.game.seed);
  });

  on(el.copy, 'click', function () {
    var text = shareText();
    var done = function () { el.copy.textContent = 'copied'; setTimeout(function () { el.copy.textContent = 'copy result'; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy your result:', text); });
    else window.prompt('Copy your result:', text);
  });

  on(el.rulesBtn, 'click', function () {
    el.rules.hidden = !el.rules.hidden;
    el.rulesBtn.classList.toggle('active', !el.rules.hidden);
  });
  on(el.rulesClose, 'click', function () {
    el.rules.hidden = true;
    el.rulesBtn.classList.remove('active');
  });

  on(el.metricsBtn, 'click', function () {
    el.metrics.hidden = !el.metrics.hidden;
    el.metricsBtn.classList.toggle('active', !el.metrics.hidden);
    renderMetrics();
  });
  on(el.metricsClose, 'click', function () {
    el.metrics.hidden = true;
    el.metricsBtn.classList.remove('active');
  });

  /* ---------- click-aways --------------------------------------------
     Browsers report a lost window two different ways and not always both:
     `blur` fires when another window takes focus, `visibilitychange` when
     the tab is hidden or the device sleeps. Both feed one flag so a single
     switch away is counted once, not twice. Nothing here can see WHERE the
     player went - only that this page stopped being frontmost. */

  function goneAway() {
    if (state.away || !state.started || state.finished) return;
    state.away = true;
    state.awayCount++;
    state.awaySince = Date.now();
    renderMetrics();
  }

  function cameBack() {
    if (!state.away) return;
    state.away = false;
    if (state.awaySince) {
      state.awaySeconds += Math.round((Date.now() - state.awaySince) / 1000);
      state.awaySince = null;
    }
    persist();
    renderMetrics();
  }

  window.addEventListener('blur', goneAway);
  window.addEventListener('focus', cameBack);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) goneAway();
    else cameBack();
  });

  window.addEventListener('beforeunload', persist);

  // ---------- boot -------------------------------------------------

  var params = new URLSearchParams(location.search);
  var forcedTier = TIER_ALIASES[(params.get('tier') || '').toLowerCase()];
  if (forcedTier && WORDS[forcedTier]) state.tier = forcedTier;

  renderAccount();

  if (PAGE === 'board') {
    /* The scoreboard page: no puzzle, no timer. ?tier= picks the opening
       board so a link can point at one. */
    boardView = forcedTier || params.get('view') || 'hard';
    if (boardView === 'mine') boardView = 'me';
    renderBoard();
  } else {
    var forcedWord = SL.normalize(params.get('word') || '');
    if (forcedWord) {
      /* ?word= sets the word but not the difficulty, and a round filed
         under the wrong tier lands on the wrong leaderboard — an erudite
         word scoring against simple ones. Look the word up in the bundled
         lists; say so plainly when it cannot be placed. */
      var known = tierOf(forcedWord);
      if (known) {
        state.tier = known;
      } else if (!params.get('tier')) {
        console.warn('[synonym ladder] "' + forcedWord + '" is not in the bundled lists, so ' +
          'this round will be filed as ' + tierName(state.tier) + '. Add &tier=erudite (or ' +
          'simple / literary) to place it correctly.');
      }
      startRound({ mode: 'practice', tier: state.tier, word: forcedWord });
    } else {
      // Wait briefly for cloud.js so the daily comes from the database
      // rather than the fallback list; a slow CDN must not block the game.
      cloudReady.then(startDaily);
    }
  }
})();
