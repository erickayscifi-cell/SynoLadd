/* ------------------------------------------------------------------
   Synonym Ladder - game engine
   Pure logic, no DOM. Both network calls are injected so the engine can
   be unit-tested in Node with recorded API responses.
   ------------------------------------------------------------------ */
(function (root) {
  'use strict';

  var CONFIG = {
    maxDepth: 4,
    points: { 1: 8, 2: 4, 3: 2, 4: 1 },
    // Entries a round allows. Words that land and words that miss both spend
    // one; same-root words and repeats of what is already on the board do
    // not. Running out ends the round.
    guessLimit: 20,
    // Datamuse "ml" scores come in bands. 40M+ / a "syn" tag means a real
    // thesaurus synonym; ~30M is strongly related; ~20M is a looser
    // association. Anything above minScore counts; the weak ones are
    // labelled so the player can see which links were generous.
    strongScore: 39000000,
    minScore: 18000000,
    fetchMax: 250,
    // Safety net for unusual words whose whole response sits below minScore.
    fallbackKeep: 40,
    // Cost of a word that links to nothing: a miss or a misspelling.
    // Words sharing a root with the board are free - see the roots bucket.
    missPenalty: 1,
    // Charge a word only the first time it fails. Re-trying is free.
    chargeOncePerWord: true,
    // Re-check the red list automatically whenever the board grows.
    autoSweepTries: false
  };

  // ---------- helpers ----------------------------------------------

  function normalize(word) {
    return String(word == null ? '' : word)
      .toLowerCase()
      .replace(/[^a-z' -]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Longest suffix first, so "discordance" loses "ance" rather than "e".
     Deliberately blunt - it only has to spot shared roots, not produce
     linguistically correct stems.

     Each suffix carries the number of letters that must survive the strip.
     Inflections (-ing, -ed, -s) are safe to take off short words. Word-
     building endings need more left behind: stripping "-ent" and "-est" off
     four letters made "content" and "contest" the same word. */
  var INFLECTIONS = ['ically', 'iously', 'ously', 'ingly', 'ally', 'ing', 'ely', 'ed', 'es', 'ly', 's'];
  var DERIVATIONS = [
    'ations', 'ation', 'ances', 'ences', 'ments', 'nesses', 'ility', 'ities', 'ability',
    'ance', 'ence', 'ment', 'ness', 'ious', 'ous', 'ive', 'ify', 'ism', 'ist',
    'ity', 'ant', 'ent', 'ion', 'ate', 'able', 'ible', 'ful', 'less',
    'est', 'al', 'er', 'y'
  ];

  var SUFFIXES = INFLECTIONS.map(function (s) { return { suffix: s, keep: 4 }; })
    .concat(DERIVATIONS.map(function (s) { return { suffix: s, keep: 5 }; }))
    .sort(function (a, b) { return b.suffix.length - a.suffix.length; });

  function stem(word) {
    var w = word.replace(/'/g, '');
    // one pass only - stacking strips turns "caress" into "care"
    for (var i = 0; i < SUFFIXES.length; i++) {
      var s = SUFFIXES[i].suffix;
      if (w.length - s.length >= SUFFIXES[i].keep && w.slice(-s.length) === s) {
        w = w.slice(0, -s.length);
        break;
      }
    }
    // collapse a doubled final consonant ("slamming" -> "slamm" -> "slam")
    if (w.length > 3 && w[w.length - 1] === w[w.length - 2]) w = w.slice(0, -1);
    // "-i" left behind by things like "happily" -> "happi"
    if (w.length > 3 && w[w.length - 1] === 'i') w = w.slice(0, -1) + 'y';
    return w;
  }

  /* Same word wearing a different ending? "discord"/"discordant",
     "touch"/"touching", "pinch"/"pinches". Those are not separate answers,
     so they are set aside - but they are NOT wrong, and cost nothing.

     The rules are deliberately conservative. An earlier version allowed the
     shorter word one mismatched trailing letter, which read "reset" and
     "research" as the same root. A shared root now means the shorter word
     really is the front of the longer one. */
  function isVariant(guess, other) {
    if (guess === other) return true;
    if (stem(guess) === stem(other)) return true;

    var longer = guess.length >= other.length ? guess : other;
    var shorter = guess.length >= other.length ? other : guess;

    // the shorter word is the whole front of the longer one, allowing for a
    // dropped silent "e" ("squeeze" -> "squeezing")
    var base = shorter[shorter.length - 1] === 'e' ? shorter.slice(0, -1) : shorter;
    if (base.length >= 4 && longer.slice(0, base.length) === base) return true;

    /* Short words a letter or two apart, where stemming missed the ending.
       The match must start at the front: endings are added, not prefixed,
       and matching anywhere made "lick" a variant of "flick". */
    if (shorter.length >= 4 && longer.length - shorter.length <= 2 &&
        longer.indexOf(shorter) === 0) return true;

    /* Endings that change shape mid-word: "resolve"/"resolution",
       "decline"/"declination". Needs a long shared front, almost nothing
       left on the shorter word, and a clearly longer partner - which is what
       keeps "content"/"contest" (same length) and "reset"/"research"
       (four shared letters) apart. */
    var shared = 0;
    while (shared < shorter.length && longer[shared] === shorter[shared]) shared++;
    if (shared >= 5 && shorter.length - shared <= 2 &&
        longer.length - shorter.length >= 3) return true;

    return false;
  }

  // ---------- default browser fetchers -----------------------------

  function defaultFetcher(word) {
    var url = 'https://api.datamuse.com/words?max=' + CONFIG.fetchMax +
              '&ml=' + encodeURIComponent(word);
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('lookup failed (' + res.status + ')');
      return res.json();
    }).then(parseRelated);
  }

  /* One tiny call per word for the metrics panel: syllable count, parts of
     speech and corpus frequency. Failures are silent - metrics degrade,
     play does not. */
  function defaultInfoFetcher(word) {
    var url = 'https://api.datamuse.com/words?max=1&md=fps&sp=' + encodeURIComponent(word);
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('info lookup failed (' + res.status + ')');
      return res.json();
    }).then(function (rows) { return parseInfo(word, rows); });
  }

  /* Turn the raw Datamuse array into { word: {score, syn} }.
     Multi-word phrases are dropped - single words keep the table clean. */
  function parseRelated(rows) {
    var clean = (rows || []).map(function (row) {
      return {
        word: normalize(row.word),
        score: typeof row.score === 'number' ? row.score : 0,
        syn: !!(row.tags && row.tags.indexOf('syn') !== -1)
      };
    }).filter(function (row) { return row.word && row.word.indexOf(' ') === -1; });

    var kept = clean.filter(function (row) { return row.syn || row.score >= CONFIG.minScore; });
    if (!kept.length) {
      // Whole response is below the usual bands - keep the strongest anyway
      // rather than leaving the word with no neighbours at all.
      kept = clean.slice()
                  .sort(function (a, b) { return b.score - a.score; })
                  .slice(0, CONFIG.fallbackKeep);
    }

    var out = {};
    kept.forEach(function (row) {
      var prev = out[row.word];
      if (!prev || row.score > prev.score) out[row.word] = { score: row.score, syn: row.syn };
    });
    return out;
  }

  var POS_TAGS = ['n', 'v', 'adj', 'adv'];

  function parseInfo(word, rows) {
    var row = (rows || []).filter(function (r) { return normalize(r.word) === word; })[0];
    if (!row) return { known: false, syllables: null, freq: null, pos: [] };
    var pos = [], freq = null;
    (row.tags || []).forEach(function (tag) {
      if (POS_TAGS.indexOf(tag) !== -1) pos.push(tag);
      else if (tag.slice(0, 2) === 'f:') freq = parseFloat(tag.slice(2));
    });
    return {
      known: true,
      syllables: typeof row.numSyllables === 'number' ? row.numSyllables : null,
      freq: freq,          // occurrences per million words of text
      pos: pos
    };
  }

  // ---------- game -------------------------------------------------

  function createGame(options) {
    options = options || {};
    var cfg = Object.assign({}, CONFIG, options.config || {});
    var fetcher = options.fetcher || defaultFetcher;
    var infoFetcher = options.infoFetcher || defaultInfoFetcher;

    var seed = normalize(options.seed);

    var neighbours = {};      // word -> related map (cache of API results)
    var pending = {};         // word -> promise, so we never fetch twice
    var info = {};            // word -> {syllables, freq, pos}
    var found = [];           // [{word, depth, parent, quality, points}]
    var byWord = {};          // word -> entry
    var tries = [];           // [{word, reason, cost, resolved}] - the red list
    var byTry = {};           // word -> try
    var roots = [];           // [{word, sameAs}] - neutral, no cost
    var byRoot = {};          // word -> root note
    var guesses = 0;
    var typedChars = 0;

    function related(word) {
      if (neighbours[word]) return Promise.resolve(neighbours[word]);
      if (pending[word]) return pending[word];
      pending[word] = Promise.resolve(fetcher(word)).then(function (map) {
        neighbours[word] = map || {};
        delete pending[word];
        return neighbours[word];
      }).catch(function (err) {
        delete pending[word];
        throw err;
      });
      return pending[word];
    }

    function loadInfo(word) {
      if (info[word]) return Promise.resolve(info[word]);
      return Promise.resolve(infoFetcher(word)).then(function (data) {
        info[word] = data || { known: false, syllables: null, freq: null, pos: [] };
        return info[word];
      }).catch(function () {
        info[word] = { known: false, syllables: null, freq: null, pos: [] };
        return info[word];
      });
    }

    /* Strength of the link between two words, checked in BOTH directions -
       thesaurus data is asymmetric, so "caress" may not list under "touch"
       while "touch" does list under "caress". */
    function linkQuality(a, b) {
      if (a === b) return null;
      var best = null;
      [[a, b], [b, a]].forEach(function (pair) {
        var map = neighbours[pair[0]];
        if (!map) return;
        var hit = map[pair[1]];
        if (!hit) return;
        var q = (hit.syn || hit.score >= cfg.strongScore) ? 'strong' : 'loose';
        if (q === 'strong' || !best) best = q;
      });
      return best;
    }

    /* Breadth-first from the seed across every word on the board, so each
       one carries its SHORTEST trace back to the seed. Run after each new
       word: a late arrival can shorten an existing word's route (a 4th-order
       word becomes 3rd, and scores accordingly). */
    function relax() {
      var dist = {}, parentOf = {};
      dist[seed] = 0;
      var frontier = [seed];
      var depth = 0;

      while (frontier.length && depth < cfg.maxDepth) {
        var next = [];
        frontier.forEach(function (u) {
          found.forEach(function (e) {
            if (dist[e.word] !== undefined) return;
            if (!linkQuality(u, e.word)) return;
            dist[e.word] = depth + 1;
            parentOf[e.word] = u;
            next.push(e.word);
          });
        });
        frontier = next;
        depth++;
      }

      found.forEach(function (e) {
        var d = dist[e.word];
        if (d === undefined || d < 1) return;   // keep what we had
        e.depth = d;
        e.parent = parentOf[e.word];
        e.points = cfg.points[d] || 0;
        e.quality = linkQuality(e.parent, e.word) || e.quality;
      });
    }

    /* Shallowest valid placement wins. */
    function placement(guess) {
      for (var depth = 1; depth <= cfg.maxDepth; depth++) {
        var parents = depth === 1 ? [seed] : found.filter(function (e) {
          return e.depth === depth - 1;
        }).map(function (e) { return e.word; });

        for (var i = 0; i < parents.length; i++) {
          var q = linkQuality(parents[i], guess);
          if (q) return { depth: depth, parent: parents[i], quality: q };
        }
      }
      return null;
    }

    /* Every word that can still parent a new find must have its neighbour
       list cached before we test a guess, otherwise a fast typist can beat
       the background fetch and lose a legitimate link. */
    function ensureFrontier() {
      var need = [seed];
      found.forEach(function (e) { need.push(e.word); });
      var jobs = need.filter(function (w) { return !neighbours[w]; })
                     .map(function (w) { return related(w).catch(function () {}); });
      return jobs.length ? Promise.all(jobs) : Promise.resolve();
    }

    function start() {
      loadInfo(seed);
      return related(seed).then(function () { return { seed: seed }; });
    }

    /* Rebuild a saved round (page refresh, returning to today's puzzle). */
    function restore(entries, savedTries, savedRoots) {
      found = [];
      byWord = {};
      tries = [];
      byTry = {};
      roots = [];
      byRoot = {};
      (savedRoots || []).forEach(function (r) {
        var word = normalize(r.word);
        if (!word || byRoot[word]) return;
        var note = { word: word, sameAs: normalize(r.sameAs) };
        roots.push(note);
        byRoot[word] = note;
      });
      (savedTries || []).forEach(function (t) {
        var word = normalize(t.word);
        if (!word || byTry[word]) return;
        var item = {
          word: word,
          reason: t.reason || 'miss',
          cost: typeof t.cost === 'number' ? t.cost : cfg.missPenalty,
          resolved: !!t.resolved
        };
        tries.push(item);
        byTry[word] = item;
      });
      (entries || []).forEach(function (e) {
        var word = normalize(e.word);
        if (!word || byWord[word]) return;
        var entry = {
          word: word,
          depth: e.depth,
          parent: normalize(e.parent),
          quality: e.quality || 'loose',
          points: cfg.points[e.depth] || 0
        };
        found.push(entry);
        byWord[word] = entry;
        loadInfo(word);
      });
      guesses = found.length + tries.length;
      typedChars = found.concat(tries).concat(roots)
        .reduce(function (n, e) { return n + e.word.length; }, 0);
      return ensureFrontier().then(function () { relax(); });
    }

    function admit(guess, spot) {
      var entry = {
        word: guess,
        depth: spot.depth,
        parent: spot.parent,
        quality: spot.quality,
        points: cfg.points[spot.depth] || 0
      };
      found.push(entry);
      byWord[guess] = entry;
      loadInfo(guess);

      var wasTried = byTry[guess];
      if (wasTried) wasTried.resolved = true;   // stays on the red list, cost already paid

      relax();                                  // the new word may shorten other traces
      var swept = cfg.autoSweepTries ? sweep() : [];
      return { status: 'accepted', entry: entry, resolvedTry: !!wasTried, swept: swept };
    }

    function guessesLeft() {
      return Math.max(cfg.guessLimit - guesses, 0);
    }

    function limitReached() {
      return guessesLeft() === 0;
    }

    function submit(raw) {
      var guess = normalize(raw);
      if (limitReached()) {
        return Promise.resolve(reject('over', 'Round over — all ' + cfg.guessLimit + ' entries used.'));
      }
      if (!guess) return Promise.resolve(reject('invalid', 'Type a word.'));
      if (guess.indexOf(' ') !== -1) {
        return Promise.resolve(reject('invalid', 'Single words only.'));
      }
      typedChars += guess.length;

      if (byWord[guess]) {
        return Promise.resolve(reject('duplicate', '“' + guess + '” is already on the board.'));
      }

      var retry = byTry[guess] && !byTry[guess].resolved;

      // Shared roots are set aside, not punished: the player knew a real
      // word, it just is not a separate answer.
      if (isVariant(guess, seed)) return Promise.resolve(noteRoot(guess, seed));
      for (var i = 0; i < found.length; i++) {
        if (isVariant(guess, found[i].word)) {
          return Promise.resolve(noteRoot(guess, found[i].word));
        }
      }

      guesses++;

      return related(guess).then(ensureFrontier).then(function () {
        var spot = placement(guess);
        var result = spot ? admit(guess, spot)
          : retry
            ? reject('retry', '“' + guess + '” still links to nothing — no extra cost.')
            : charge(guess, 'miss', 'No link from “' + guess + '” to anything on the board.');
        result.left = guessesLeft();
        result.over = limitReached();
        return result;
      }).catch(function (err) {
        // A failed lookup should not cost an entry.
        guesses--;
        typedChars -= guess.length;
        return reject('error', err && err.message ? err.message : 'Lookup failed.');
      });
    }

    /* Re-test every unresolved word on the red list against the board as it
       stands now. A word that was a miss at rung 2 can become a legitimate
       4th-order word later. Costs no requests - every map is already cached. */
    function sweep() {
      var landed = [];
      tries.forEach(function (t) {
        if (t.resolved || byWord[t.word]) return;
        var spot = placement(t.word);
        if (!spot) return;
        var entry = {
          word: t.word,
          depth: spot.depth,
          parent: spot.parent,
          quality: spot.quality,
          points: cfg.points[spot.depth] || 0
        };
        found.push(entry);
        byWord[t.word] = entry;
        t.resolved = true;
        loadInfo(t.word);
        landed.push(entry);
      });
      if (landed.length) relax();
      return landed;
    }

    function reject(status, message) {
      return { status: status, message: message };
    }

    /* Neutral bucket: same root as something already in play. No cost, no
       red mark - it just cannot be its own answer. */
    function noteRoot(word, sameAs) {
      var item = byRoot[word];
      if (!item) {
        item = { word: word, sameAs: sameAs };
        roots.push(item);
        byRoot[word] = item;
      }
      return {
        status: 'root',
        item: item,
        message: '“' + word + '” shares a root with “' + sameAs + '” — set aside, no cost.'
      };
    }

    /* A word that did not land: onto the red list it goes, one point off.
       No spellcheck anywhere - a misspelling is simply a word that links to
       nothing, and it is charged like any other miss. Charged once only:
       the same word can be tried again for free as the board grows. */
    function charge(word, reason, message) {
      var existing = byTry[word];
      if (existing && cfg.chargeOncePerWord) {
        return { status: 'retry', reason: reason, message: message + ' No extra cost.', item: existing };
      }
      var item = { word: word, reason: reason, cost: cfg.missPenalty, resolved: false };
      tries.push(item);
      byTry[word] = item;
      return { status: 'rejected', reason: reason, message: message, item: item };
    }

    function rawScore() {
      return found.reduce(function (sum, e) { return sum + e.points; }, 0);
    }

    function penalty() {
      return tries.reduce(function (sum, t) { return sum + t.cost; }, 0);
    }

    function score() {
      return rawScore() - penalty();
    }

    function counts() {
      var out = {};
      for (var d = 1; d <= cfg.maxDepth; d++) out[d] = 0;
      found.forEach(function (e) { out[e.depth]++; });
      return out;
    }

    /* Words the player never found, for the end-of-round reveal. Only pulls
       from data already cached, so it costs no extra requests. */
    function missed(limit) {
      var map = neighbours[seed] || {};
      var out = Object.keys(map).filter(function (w) {
        if (byWord[w] || isVariant(w, seed)) return false;
        return map[w].syn || map[w].score >= cfg.strongScore;
      }).sort(function (a, b) { return map[b].score - map[a].score; });
      return out.slice(0, limit || 12);
    }

    // ---------- graph + metrics ------------------------------------

    /* The whole board as an undirected graph: the seed plus every word
       found, with an edge wherever the thesaurus links two of them -
       including the cross-links that scoring ignores. */
    function graph() {
      var nodes = [seed].concat(found.map(function (e) { return e.word; }));
      var adj = {};
      nodes.forEach(function (n) { adj[n] = []; });
      var edges = [];
      for (var i = 0; i < nodes.length; i++) {
        for (var j = i + 1; j < nodes.length; j++) {
          var q = linkQuality(nodes[i], nodes[j]);
          if (!q) continue;
          edges.push({ a: nodes[i], b: nodes[j], quality: q });
          adj[nodes[i]].push(nodes[j]);
          adj[nodes[j]].push(nodes[i]);
        }
      }
      return { nodes: nodes, edges: edges, adj: adj };
    }

    function median(list) {
      if (!list.length) return null;
      var s = list.slice().sort(function (a, b) { return a - b; });
      var mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }

    function mean(list) {
      if (!list.length) return null;
      return list.reduce(function (a, b) { return a + b; }, 0) / list.length;
    }

    function topology() {
      var g = graph();
      var n = g.nodes.length;
      var m = g.edges.length;
      var degrees = g.nodes.map(function (w) { return g.adj[w].length; });

      // local clustering: how often a word's neighbours are also linked
      var clustering = g.nodes.map(function (w) {
        var nb = g.adj[w];
        if (nb.length < 2) return 0;
        var links = 0;
        for (var i = 0; i < nb.length; i++) {
          for (var j = i + 1; j < nb.length; j++) {
            if (g.adj[nb[i]].indexOf(nb[j]) !== -1) links++;
          }
        }
        return (2 * links) / (nb.length * (nb.length - 1));
      });

      var hubIndex = degrees.indexOf(Math.max.apply(null, degrees.concat([0])));
      var traces = found.map(function (e) { return e.depth; });
      var treeEdges = found.length;              // one parent each
      var byRung = counts();
      var branching = {};
      for (var d = 1; d < cfg.maxDepth; d++) {
        branching[d] = byRung[d] ? +(byRung[d + 1] / byRung[d]).toFixed(2) : null;
      }

      return {
        nodes: n,
        edges: m,
        // how much of the possible wiring exists
        density: n > 1 ? +((2 * m) / (n * (n - 1))).toFixed(3) : 0,
        meanDegree: m ? +((2 * m) / n).toFixed(2) : 0,
        maxDegree: degrees.length ? Math.max.apply(null, degrees) : 0,
        hub: g.nodes[hubIndex] || null,
        // links beyond the scoring tree, i.e. the loops the game ignores
        extraLinks: Math.max(m - treeEdges, 0),
        independentCycles: Math.max(m - n + 1, 0),
        meanTrace: traces.length ? +mean(traces).toFixed(2) : 0,
        maxTrace: traces.length ? Math.max.apply(null, traces) : 0,
        meanClustering: +(mean(clustering) || 0).toFixed(3),
        leaves: degrees.filter(function (d) { return d === 1; }).length,
        rungWidths: byRung,
        branching: branching
      };
    }

    function linguistics() {
      var words = found.map(function (e) { return e.word; });
      var infos = words.map(function (w) { return info[w] || {}; });
      var known = infos.filter(function (i) { return i.known; });

      var syllables = infos.map(function (i) { return i.syllables; })
                           .filter(function (s) { return typeof s === 'number'; });
      var freqs = infos.map(function (i) { return i.freq; })
                       .filter(function (f) { return typeof f === 'number' && f > 0; });
      var logFreqs = freqs.map(function (f) { return Math.log10(f); });

      var pos = { n: 0, v: 0, adj: 0, adv: 0, untagged: 0 };
      infos.forEach(function (i) {
        if (!i.pos || !i.pos.length) { pos.untagged++; return; }
        i.pos.forEach(function (p) { if (pos[p] !== undefined) pos[p]++; });
      });

      var rarest = null, commonest = null;
      words.forEach(function (w) {
        var f = (info[w] || {}).freq;
        if (typeof f !== 'number') return;
        if (!rarest || f < rarest.freq) rarest = { word: w, freq: f };
        if (!commonest || f > commonest.freq) commonest = { word: w, freq: f };
      });

      var seedInfo = info[seed] || {};

      return {
        coverage: words.length ? known.length + '/' + words.length : '0/0',
        meanSyllables: syllables.length ? +mean(syllables).toFixed(2) : null,
        maxSyllables: syllables.length ? Math.max.apply(null, syllables) : null,
        // per million words of text; log10 keeps it readable
        meanLogFreq: logFreqs.length ? +mean(logFreqs).toFixed(2) : null,
        seedLogFreq: typeof seedInfo.freq === 'number' && seedInfo.freq > 0
          ? +Math.log10(seedInfo.freq).toFixed(2) : null,
        rarest: rarest,
        commonest: commonest,
        pos: pos,
        // share of words that are not the seed's own part of speech
        posSpread: Object.keys(pos).filter(function (k) {
          return k !== 'untagged' && pos[k] > 0;
        }).length
      };
    }

    function characters() {
      var words = found.map(function (e) { return e.word; });
      var lengths = words.map(function (w) { return w.length; });
      var hist = {};
      lengths.forEach(function (l) { hist[l] = (hist[l] || 0) + 1; });

      var letters = {};
      words.join('').split('').forEach(function (c) { letters[c] = (letters[c] || 0) + 1; });

      var longest = null, shortest = null;
      words.forEach(function (w) {
        if (!longest || w.length > longest.length) longest = w;
        if (!shortest || w.length < shortest.length) shortest = w;
      });

      return {
        boardChars: lengths.reduce(function (a, b) { return a + b; }, 0),
        typedChars: typedChars,
        meanLength: lengths.length ? +mean(lengths).toFixed(2) : null,
        medianLength: median(lengths),
        shortest: shortest,
        longest: longest,
        histogram: hist,
        distinctInitials: Object.keys(words.reduce(function (acc, w) {
          acc[w[0]] = 1; return acc;
        }, {})).length,
        distinctLetters: Object.keys(letters).length
      };
    }

    function metrics() {
      return {
        seed: seed,
        score: score(),
        rawScore: rawScore(),
        penalty: penalty(),
        guesses: guesses,
        guessLimit: cfg.guessLimit,
        guessesLeft: guessesLeft(),
        hitRate: guesses ? +(found.length / guesses).toFixed(2) : 0,
        rootsSetAside: roots.length,
        pointsPerEntry: guesses ? +(score() / guesses).toFixed(2) : 0,
        topology: topology(),
        linguistics: linguistics(),
        characters: characters()
      };
    }

    return {
      seed: seed,
      config: cfg,
      start: start,
      restore: restore,
      submit: submit,
      sweep: sweep,
      found: function () { return found.slice(); },
      tries: function () { return tries.slice(); },
      roots: function () { return roots.slice(); },
      score: score,
      rawScore: rawScore,
      penalty: penalty,
      counts: counts,
      guesses: function () { return guesses; },
      guessesLeft: guessesLeft,
      limitReached: limitReached,
      missed: missed,
      graph: graph,
      metrics: metrics,
      info: function (word) { return info[normalize(word)] || null; },
      _neighbours: neighbours
    };
  }

  var api = {
    createGame: createGame,
    parseRelated: parseRelated,
    parseInfo: parseInfo,
    normalize: normalize,
    stem: stem,
    isVariant: isVariant,
    CONFIG: CONFIG
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SynonymLadder = api;
})(typeof window !== 'undefined' ? window : globalThis);
