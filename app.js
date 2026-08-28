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
    boardBtn: byId('btn-board'),
    board: byId('board'),
    boardClose: byId('btn-board-close'),
    boardWhere: byId('board-where'),
    boardTabs: byId('board-tabs'),
    boardThead: byId('board-thead'),
    boardTbody: byId('board-tbody'),
    boardNote: byId('board-note'),
    rename: byId('btn-rename'),
    summary: byId('summary'),
    summaryTitle: byId('summary-title'),
    overReason: byId('over-reason'),
    overFlag: byId('over-flag'),
    summaryGrid: byId('summary-grid'),
    summaryMissed: byId('summary-missed'),
    copy: byId('btn-copy'),
    again: byId('btn-again')
  };

  var state = {
    mode: 'daily',
    tier: 'easy',
    game: null,
    elapsed: 0,          // seconds
    started: false,      // has a word been entered yet?
    ticking: false,
    finished: false,
    reason: null,        // 'limit' | 'stopped' | 'saved'
    filed: false,        // has this round been sent to the scoreboard?
    tickHandle: null,
    // window focus tracking
    away: false,
    awayCount: 0,
    awaySeconds: 0,
    awaySince: null
  };

  function byId(id) { return document.getElementById(id); }

  function tierName(tier) { return TIER_LABELS[tier] || tier; }

  /* ---------- scoreboard ------------------------------------------------
     One facade, two drivers. Without Supabase credentials it keeps rounds
     in this browser; cloud.js registers itself when configured and the UI
     does not change shape either way. */

  var scoreboard = SB.createScoreboard({
    local: SB.createLocalDriver(safeStorage()),
    cloudConfigured: !!(CFG.supabaseUrl && CFG.supabaseAnonKey)
  });

  // published so cloud.js can find it once it loads
  window.SLGame = { scoreboard: scoreboard };

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

  function randomWord(tier, avoid) {
    var list = WORDS[tier].filter(function (w) { return w !== avoid; });
    return list[Math.floor(Math.random() * list.length)];
  }

  // ---------- round lifecycle --------------------------------------

  function startRound(opts) {
    state.mode = opts.mode;
    state.tier = opts.tier;
    state.finished = false;
    state.started = false;
    state.reason = null;
    state.filed = false;
    state.away = false;
    state.awayCount = 0;
    state.awaySeconds = 0;
    state.awaySince = null;
    state.elapsed = opts.elapsed || 0;
    state.game = SL.createGame({ seed: opts.word });

    el.seed.textContent = opts.word;
    el.seedLabel.textContent = opts.mode === 'daily'
      ? 'daily puzzle · ' + tierName(opts.tier) + ' · ' + todayKey()
      : 'practice · ' + tierName(opts.tier);
    el.tierPicker.hidden = opts.mode !== 'practice';
    el.newWord.hidden = opts.mode !== 'practice';
    el.summary.hidden = true;
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
        return state.game.restore(saved.found, saved.tries, saved.roots).then(function () {
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
      el.time.textContent = clock(state.elapsed);
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

  function persist() {
    if (state.mode !== 'daily' || !state.game) return;
    save('daily:' + todayKey(), {
      seed: state.game.seed,
      found: state.game.found(),
      tries: state.game.tries(),
      roots: state.game.roots(),
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

  el.form.addEventListener('submit', function (e) {
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
        render(entry.word);
      } else if (result.status === 'rejected') {
        // Links to nothing: onto the red list, -1.
        el.guess.value = '';
        say(result.message + ' −' + result.item.cost + left(result), 'no');
        render();
      } else if (result.status === 'root') {
        // Same root as something in play: neutral, costs nothing.
        el.guess.value = '';
        say(result.message, 'neutral');
        render();
      } else {
        // Empty input, a phrase, a repeat, or a failed lookup: no charge.
        say(result.message, 'no');
        el.guess.select();
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
    el.score.textContent = state.game ? state.game.score() : 0;
    el.words.textContent = found.length;
    var remaining = state.game ? state.game.guessesLeft() : 0;
    el.left.textContent = remaining;
    el.left.classList.toggle('miss', remaining <= 5);
    el.time.textContent = clock(state.elapsed);
    renderTries();
    renderMetrics();
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
      var from = document.createElement('span');
      from.className = 'from';
      from.textContent = '← ' + entry.parent;
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
    if (el.metrics.hidden || !state.game) return;
    var m = state.game.metrics();
    var t = m.topology, l = m.linguistics, c = m.characters;

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
        ['click-aways', state.awayCount + (state.away ? ' (away now)' : ''),
          'times this window lost focus mid-round — another window, another tab, or the screen sleeping'],
        ['time away', clock(state.awaySeconds), 'counted inside the clock, not deducted from it']
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

    el.metricGroups.innerHTML = '';
    groups.forEach(function (group) {
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
      el.metricGroups.appendChild(box);
    });

    renderHistogram(c.histogram);
  }

  function renderHistogram(hist) {
    var lengths = Object.keys(hist).map(Number).sort(function (a, b) { return a - b; });
    el.hist.innerHTML = '';
    if (!lengths.length) {
      el.hist.textContent = '—';
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
      el.hist.appendChild(row);
    }
  }

  // ---------- account + scoreboard UI ------------------------------

  var boardView = 'hard';

  function renderAccount() {
    var id = scoreboard.identity();
    var remote = scoreboard.remoteIdentity();
    el.who.textContent = id.username || 'not signed in';
    el.who.title = id.source === 'google' ? 'signed in with Google'
      : id.source === 'anonymous' ? 'anonymous account — this device only'
      : 'saved in this browser only';
    // Only offer sign-in when there is something to sign in to.
    el.signInBtn.hidden = !scoreboard.hasRemote() || (remote && remote.signedIn);
  }

  function boardHeaders(view) {
    return view === 'me'
      ? ['when', 'word', 'tier', 'score', '1st', 'entries', 'hit', 'pts/entry', 'time']
      : ['#', 'player', 'score', 'word', '1st', 'entries', 'hit', 'pts/entry', 'time'];
  }

  function renderBoard() {
    if (el.board.hidden) return;
    var where = scoreboard.hasRemote() ? 'shared board' : 'this browser only';
    el.boardWhere.textContent = where + ' · ' + (scoreboard.identity().username || 'signed out');

    document.querySelectorAll('[data-board]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.board === boardView);
    });

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

    var job = boardView === 'me'
      ? scoreboard.myRounds(CFG.historySize || 30)
      : scoreboard.topByTier(boardView, CFG.boardSize || 25);

    job.then(function (rows) {
      if (!rows.length) {
        el.boardNote.textContent = boardView === 'me'
          ? 'No finished rounds yet. Play one and it lands here.'
          : 'No scores on this board yet — be first.';
        return;
      }
      var me = scoreboard.identity().username;
      rows.forEach(function (r, i) {
        var tr = document.createElement('tr');
        if (r.username === me) tr.className = 'mine';
        var cells = boardView === 'me'
          ? [(r.played_at || '').slice(0, 10), r.seed, tierName(r.tier), r.score, r.rung1,
             r.entries + '/' + r.entry_limit, r.hit_rate, r.points_per_entry, clock(r.seconds)]
          : [i + 1, r.username, r.score, r.seed, r.rung1,
             r.entries + '/' + r.entry_limit, r.hit_rate, r.points_per_entry, clock(r.seconds)];
        cells.forEach(function (value, col) {
          var td = document.createElement('td');
          td.textContent = (value === null || value === undefined) ? '—' : value;
          if (col === 2 && boardView !== 'me') td.className = 'num strong';
          else if (typeof value === 'number') td.className = 'num';
          tr.appendChild(td);
        });
        el.boardTbody.appendChild(tr);
      });
      el.boardNote.textContent = boardView === 'me'
        ? 'Your finished rounds, newest first. Watch 1st-order counts climb — that is the thesaurus recall improving.'
        : 'Best round per player on ' + tierName(boardView) + ' words.';
    }, function (err) {
      el.boardNote.textContent = 'Could not load the board: ' + err.message;
    });
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
      if (result.stored === 'cloud') el.boardNote.textContent = 'Round filed to the scoreboard.';
      renderBoard();
    }, function () {});
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

  scoreboard.onChange(function () {
    renderAccount();
    renderBoard();
  });

  el.boardBtn.addEventListener('click', function () {
    el.board.hidden = !el.board.hidden;
    el.boardBtn.classList.toggle('active', !el.board.hidden);
    if (!el.board.hidden) {
      if (boardView !== 'me') boardView = state.tier;
      renderBoard();
    }
  });
  el.boardClose.addEventListener('click', function () {
    el.board.hidden = true;
    el.boardBtn.classList.remove('active');
  });
  document.querySelectorAll('[data-board]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      boardView = btn.dataset.board;
      renderBoard();
    });
  });
  el.rename.addEventListener('click', askUsername);
  el.who.addEventListener('click', function () {
    var remote = scoreboard.remoteIdentity();
    if (scoreboard.hasRemote() && !(remote && remote.signedIn)) openSheet();
    else askUsername();
  });

  function openSheet() {
    el.sheetNote.textContent = '';
    el.sheet.hidden = false;
  }
  el.signInBtn.addEventListener('click', openSheet);
  el.sheetClose.addEventListener('click', function () { el.sheet.hidden = true; });
  el.google.addEventListener('click', function () {
    el.sheetNote.textContent = 'redirecting to Google…';
    scoreboard.signIn('google').catch(function (err) {
      el.sheetNote.textContent = err.message;
    });
  });
  el.anon.addEventListener('click', function () {
    el.sheetNote.textContent = 'creating an anonymous account…';
    scoreboard.signIn('anonymous').then(function () {
      el.sheet.hidden = true;
    }, function (err) {
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

    var limit = state.game.config.guessLimit;
    el.overReason.textContent = state.reason === 'limit'
      ? 'All ' + limit + ' entries used.'
      : state.reason === 'stopped'
        ? 'You called it after ' + state.game.guesses() + ' of ' + limit + ' entries.'
        : 'Saved from an earlier session.';

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
    el.overFlag.textContent = state.reason === 'limit' ? 'no entries left' : 'round over';
    if (!silent) el.summary.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.metrics.hidden = false;
    el.metricsBtn.classList.add('active');
    renderMetrics();
    el.again.textContent = state.mode === 'daily' ? 'try practice mode' : 'play again';

    // A finished round is filed once; re-showing a saved daily is not a replay.
    if (!silent && !state.filed) {
      state.filed = true;
      saveRound();
    }
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

  document.querySelectorAll('[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      stopTimer();
      if (btn.dataset.mode === 'daily') {
        var p = dailyPuzzle();
        startRound({ mode: 'daily', tier: p.tier, word: p.word });
      } else {
        startRound({ mode: 'practice', tier: state.tier, word: randomWord(state.tier) });
      }
    });
  });

  document.querySelectorAll('[data-tier]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.tier = btn.dataset.tier;
      stopTimer();
      startRound({ mode: 'practice', tier: state.tier, word: randomWord(state.tier) });
    });
  });

  el.newWord.addEventListener('click', function () {
    stopTimer();
    startRound({
      mode: 'practice',
      tier: state.tier,
      word: randomWord(state.tier, state.game && state.game.seed)
    });
  });

  el.finish.addEventListener('click', function () { finishRound(false); });

  el.again.addEventListener('click', function () {
    stopTimer();
    startRound({ mode: 'practice', tier: state.tier, word: randomWord(state.tier, state.game && state.game.seed) });
  });

  el.copy.addEventListener('click', function () {
    var text = shareText();
    var done = function () { el.copy.textContent = 'copied'; setTimeout(function () { el.copy.textContent = 'copy result'; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy your result:', text); });
    else window.prompt('Copy your result:', text);
  });

  el.rulesBtn.addEventListener('click', function () {
    el.rules.hidden = !el.rules.hidden;
    el.rulesBtn.classList.toggle('active', !el.rules.hidden);
  });
  el.rulesClose.addEventListener('click', function () {
    el.rules.hidden = true;
    el.rulesBtn.classList.remove('active');
  });

  el.metricsBtn.addEventListener('click', function () {
    el.metrics.hidden = !el.metrics.hidden;
    el.metricsBtn.classList.toggle('active', !el.metrics.hidden);
    renderMetrics();
  });
  el.metricsClose.addEventListener('click', function () {
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
  var forcedWord = SL.normalize(params.get('word') || '');
  var forcedTier = TIER_ALIASES[(params.get('tier') || '').toLowerCase()];
  if (forcedTier && WORDS[forcedTier]) state.tier = forcedTier;

  renderAccount();

  if (forcedWord) {
    startRound({ mode: 'practice', tier: state.tier, word: forcedWord });
  } else {
    var puzzle = dailyPuzzle();
    startRound({ mode: 'daily', tier: puzzle.tier, word: puzzle.word });
  }
})();
