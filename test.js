/* Engine tests: node test.js
   Uses recorded Datamuse payloads (real bands and scores for touch/caress,
   synthetic entries for the deeper chain) so the logic can be checked without
   hitting the network. */

var SL = require('./engine.js');

var FIXTURES = {
  // real response (trimmed)
  touch: [
    { word: 'contact', score: 40027815, tags: ['syn', 'n', 'v'] },
    { word: 'stir', score: 40011463, tags: ['syn', 'v', 'n'] },
    { word: 'pinch', score: 40008712, tags: ['syn', 'n', 'v'] },
    { word: 'trace', score: 40007863, tags: ['syn', 'n', 'v'] },
    { word: 'touch on', score: 40027801, tags: ['syn', 'v'] },
    { word: 'grope', score: 30024662, tags: ['v', 'n'] },
    { word: 'push', score: 30017036, tags: ['v', 'n'] },
    { word: 'feel', score: 30015159, tags: ['v', 'n'] },
    { word: 'touching', score: 6036, tags: ['adj'] }
  ],
  // real response (trimmed) - note it lists "touch" at the weaker 20M band
  caress: [
    { word: 'fondle', score: 30021602, tags: ['v', 'n'] },
    { word: 'stroke', score: 30011430, tags: ['n', 'v'] },
    { word: 'touch', score: 20021731, tags: ['n'] }
  ],
  // synthetic, to exercise depth 3 / 4 / cutoff and loop handling
  fondle: [{ word: 'caress', score: 30021000, tags: [] }, { word: 'dandle', score: 20010000, tags: [] }],
  dandle: [{ word: 'fondle', score: 20009000, tags: [] }, { word: 'jiggle', score: 20008000, tags: [] }],
  jiggle: [{ word: 'dandle', score: 20007000, tags: [] }, { word: 'wobble', score: 20006000, tags: [] }],
  wobble: [{ word: 'jiggle', score: 20005000, tags: [] }],
  cuddle: [{ word: 'touch', score: 20004000, tags: [] }, { word: 'dandle', score: 20003000, tags: [] }],
  contact: [{ word: 'touch', score: 40000000, tags: ['syn'] }],
  feel: [{ word: 'touch', score: 30000000, tags: [] }],
  stroke: [{ word: 'caress', score: 30000000, tags: [] }],
  banana: [{ word: 'plantain', score: 30000000, tags: [] }]
};

/* sp= lookups for the metrics panel: syllables, parts of speech, frequency */
var INFO = {
  touch:   { numSyllables: 1, tags: ['f:127.5', 'n', 'v'] },
  contact: { numSyllables: 2, tags: ['f:98.2', 'n', 'v'] },
  feel:    { numSyllables: 1, tags: ['f:210.4', 'v', 'n'] },
  caress:  { numSyllables: 2, tags: ['f:0.62', 'v', 'n'] },
  fondle:  { numSyllables: 2, tags: ['f:0.21', 'v'] },
  dandle:  { numSyllables: 2, tags: ['f:0.01', 'v'] },
  jiggle:  { numSyllables: 2, tags: ['f:0.33', 'v', 'n'] },
  cuddle:  { numSyllables: 2, tags: ['f:1.1', 'v', 'n'] },
  grope:   { numSyllables: 1, tags: ['f:0.9', 'v', 'n'] },
  stroke:  { numSyllables: 1, tags: ['f:14.6', 'n', 'v'] },
  wobble:  { numSyllables: 2, tags: ['f:0.7', 'v', 'n'] }
};

var calls = [];

function fetcher(word) {
  calls.push(word);
  return Promise.resolve(SL.parseRelated(FIXTURES[word] || []));
}

function infoFetcher(word) {
  var row = INFO[word];
  return Promise.resolve(SL.parseInfo(word, row ? [Object.assign({ word: word }, row)] : []));
}

var pass = 0, fail = 0;

function check(label, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label + '\n         got ' + a + '\n         want ' + e); }
}

var game = SL.createGame({ seed: 'touch', fetcher: fetcher, infoFetcher: infoFetcher });

function entryFor(word) {
  return game.found().filter(function (e) { return e.word === word; })[0] || {};
}
function depthOf(word) { return entryFor(word).depth; }
function pointsOf(word) { return entryFor(word).points; }

function guess(word) {
  return game.submit(word).then(function (r) {
    if (r.status === 'accepted') {
      return { status: 'accepted', depth: r.entry.depth, parent: r.entry.parent, quality: r.entry.quality, points: r.entry.points };
    }
    return r.reason ? { status: r.status, reason: r.reason } : { status: r.status };
  });
}

game.start()
  .then(function () { return guess('contact'); })
  .then(function (r) { check('strict synonym -> 1st order, 8 pts',
      r, { status: 'accepted', depth: 1, parent: 'touch', quality: 'strong', points: 8 }); })

  .then(function () { return guess('feel'); })
  .then(function (r) { check('related-band word -> 1st order, loose link',
      r, { status: 'accepted', depth: 1, parent: 'touch', quality: 'loose', points: 8 }); })

  .then(function () { return guess('caress'); })
  .then(function (r) { check('reverse-only link (caress lists touch) -> 1st order',
      r, { status: 'accepted', depth: 1, parent: 'touch', quality: 'loose', points: 8 }); })

  .then(function () { return guess('Contact'); })
  .then(function (r) { check('duplicate rejected (case-insensitive)', r, { status: 'duplicate' }); })

  .then(function () { return guess('touching'); })
  .then(function (r) { check('variant of the seed goes to the neutral bucket',
      r, { status: 'root' }); })

  .then(function () { return guess('contacts'); })
  .then(function (r) { check('plural of a found word goes to the neutral bucket',
      r, { status: 'root' }); })

  .then(function () {
    check('root words are listed with what they match',
      game.roots().map(function (r) { return r.word + '=' + r.sameAs; }),
      ['touching=touch', 'contacts=contact']);
    check('root words cost nothing', game.penalty(), 0);
    check('root words are not on the red list', game.tries().length, 0);
    return guess('touching');
  })
  .then(function () {
    check('a repeated root word is not listed twice', game.roots().length, 2);
  })

  .then(function () { return guess('touch on'); })
  .then(function (r) { check('multi-word guess rejected, no charge', r, { status: 'invalid' }); })

  .then(function () { return guess('banana'); })
  .then(function (r) { check('unrelated word charged as a try',
      r, { status: 'rejected', reason: 'miss' }); })

  .then(function () { return guess('bananna'); })
  .then(function (r) { check('misspelling is just another miss (no spellcheck)',
      r, { status: 'rejected', reason: 'miss' }); })

  .then(function () { return guess('banana'); })
  .then(function (r) { check('repeat of a tried word is not charged twice',
      r, { status: 'retry' }); })

  .then(function () { return guess('fondle'); })
  .then(function (r) { check('synonym of a 1st-order word -> 2nd order, 4 pts',
      r, { status: 'accepted', depth: 2, parent: 'caress', quality: 'loose', points: 4 }); })

  .then(function () { return guess('dandle'); })
  .then(function (r) { check('third rung -> 2 pts',
      r, { status: 'accepted', depth: 3, parent: 'fondle', quality: 'loose', points: 2 }); })

  .then(function () { return guess('jiggle'); })
  .then(function (r) { check('fourth rung -> 1 pt',
      r, { status: 'accepted', depth: 4, parent: 'dandle', quality: 'loose', points: 1 }); })

  .then(function () { return guess('wobble'); })
  .then(function (r) { check('fifth rung rejected and charged (past the cutoff)',
      r, { status: 'rejected', reason: 'miss' }); })

  .then(function () { return guess('cuddle'); })
  .then(function (r) { check('word linked to both rung 1 and rung 3 takes rung 1',
      r, { status: 'accepted', depth: 1, parent: 'touch', quality: 'loose', points: 8 }); })

  // "cuddle" gave "dandle" a shorter route, which drags "jiggle" up with it
  .then(function () {
    check('a later find shortens an existing trace (3rd -> 2nd)',
      depthOf('dandle'), 2);
    check('the shortening cascades down the chain (4th -> 3rd)',
      depthOf('jiggle'), 3);
    check('promoted word re-parents onto the shorter route',
      game.found().filter(function (e) { return e.word === 'dandle'; })[0].parent, 'cuddle');
    check('promoted word scores its new rung', pointsOf('dandle'), 4);
  })

  // ...which puts "wobble" inside the cutoff, so the red-list word can land
  .then(function () { return guess('wobble'); })
  .then(function (r) { check('a red-list word lands once the board grows around it',
      r, { status: 'accepted', depth: 4, parent: 'jiggle', quality: 'loose', points: 1 }); })
  .then(function () {
    check('the word that landed is marked resolved on the red list',
      game.tries().filter(function (t) { return t.word === 'wobble'; })[0].resolved, true);
    check('landing late does not refund, and does not charge twice', game.penalty(), 3);
  })

  .then(function () { return guess('grope'); })
  .then(function (r) { check('word reachable from seed keeps 1st order', r,
      { status: 'accepted', depth: 1, parent: 'touch', quality: 'loose', points: 8 }); })

  .then(function () {
    check('counts by rung', game.counts(), { 1: 5, 2: 2, 3: 1, 4: 1 });
    check('raw score = 5*8 + 2*4 + 2 + 1', game.rawScore(), 51);
    check('every charged try is on the red list, once each',
      game.tries().map(function (t) { return t.word; }),
      ['banana', 'bananna', 'wobble']);
    check('penalty is 1 per try', game.penalty(), 3);
    check('net score = 51 - 3', game.score(), 48);
    check('missed first-order words', game.missed(5), ['stir', 'pinch', 'trace']);
  })

  // ---- metrics ----
  .then(function () {
    var m = game.metrics();
    var t = m.topology, l = m.linguistics, c = m.characters;
    check('nodes = seed + words found', t.nodes, 10);
    check('every thesaurus link between board words is an edge', t.edges, 10);
    check('links beyond the scoring tree', t.extraLinks, 1);
    check('independent cycles = E - N + 1', t.independentCycles, 1);
    check('mean degree', t.meanDegree, 2);
    check('hub is the seed here', t.hub, 'touch');
    check('leaf words', t.leaves, 4);
    check('mean trace', t.meanTrace, 1.78);
    check('deepest trace', t.maxTrace, 4);
    check('rung widths', t.rungWidths, { 1: 5, 2: 2, 3: 1, 4: 1 });

    check('frequency data coverage', l.coverage, '9/9');
    check('mean syllables', l.meanSyllables, 1.78);
    check('rarest word by corpus frequency', l.rarest.word, 'dandle');
    check('commonest word by corpus frequency', l.commonest.word, 'feel');
    check('parts of speech counted', l.pos.v, 9);

    check('letters on the board', c.boardChars, 52);
    check('mean word length', c.meanLength, 5.78);
    check('median word length', c.medianLength, 6);
    check('longest word', c.longest, 'contact');
    check('shortest word', c.shortest, 'feel');
    check('length histogram', c.histogram, { 4: 1, 5: 1, 6: 6, 7: 1 });
    check('letters typed counts the red list too', c.typedChars > c.boardChars, true);
    check('hit rate', m.hitRate, 0.69);
  })

  // ---- automatic sweep of the red list (config flag) ----
  .then(function () {
    var auto = SL.createGame({
      seed: 'touch', fetcher: fetcher, infoFetcher: infoFetcher,
      config: { autoSweepTries: true }
    });
    return auto.start()
      .then(function () { return auto.submit('dandle'); })
      .then(function (r) {
        check('sweep: unreachable word is charged first', r.status, 'rejected');
        return auto.submit('caress');
      })
      .then(function () { return auto.submit('fondle'); })
      .then(function (r) {
        check('sweep: red-list word is picked up automatically',
          (r.swept || []).map(function (e) { return e.word + ':' + e.depth; }), ['dandle:3']);
        check('sweep: it is on the board', auto.counts(), { 1: 1, 2: 1, 3: 1, 4: 0 });
      });
  })

  .then(function () {
    // restore into a fresh game, as a page refresh would
    var again = SL.createGame({ seed: 'touch', fetcher: fetcher, infoFetcher: infoFetcher });
    return again.start()
      .then(function () { return again.restore(game.found(), game.tries(), game.roots()); })
      .then(function () {
        check('restore keeps net score', again.score(), 48);
        check('restore keeps counts', again.counts(), { 1: 5, 2: 2, 3: 1, 4: 1 });
        check('restore keeps the red list', again.tries().length, 3);
        check('restore keeps the root bucket', again.roots().length, 2);
        return again.submit('banana').then(function (r) {
          check('a restored try is still not charged twice', r.status, 'retry');
          check('penalty unchanged by the retry', again.penalty(), 3);
          return again.submit('stroke');
        }).then(function (r) {
          check('play continues after restore',
            { d: r.entry && r.entry.depth, p: r.entry && r.entry.parent }, { d: 2, p: 'caress' });
        });
      });
  })

  .then(function () {
    // shared-root rules, checked directly - no network involved
    [['discord', 'discordant'], ['discordant', 'discordance'], ['discord', 'discordantly'],
     ['touch', 'touching'], ['pinch', 'pinches'], ['harmony', 'harmonious'],
     ['sorrow', 'sorrowful'], ['gloom', 'gloomy'], ['solemn', 'solemnly'],
     ['obstruct', 'obstruction'], ['squeeze', 'squeezing'], ['resolve', 'resolution'],
     ['research', 'researcher'], ['care', 'caress'], ['decline', 'declination'],
     ['grave', 'gravity'], ['block', 'blockade']
    ].forEach(function (pair) {
      check('same root: ' + pair.join(' / '), SL.isVariant(pair[0], pair[1]), true);
    });
    [['touch', 'contact'], ['pinch', 'squeeze'], ['discordant', 'dissonant'],
     ['block', 'blow'], ['slam', 'slap'], ['principle', 'precept'],
     // words that merely start alike are separate answers
     ['reset', 'research'], ['resolve', 'reset'], ['resolve', 'research'],
     ['restrain', 'restore'], ['content', 'contest'], ['pinch', 'pinnacle'],
     ['dissonant', 'dissuade'], ['principle', 'principal'], ['divide', 'divisive'],
     ['trace', 'tract'], ['carry', 'carriage'], ['flick', 'lick'], ['slam', 'slap'],
     ['blow', 'block'], ['tip', 'tickle'], ['punch', 'pinch']
    ].forEach(function (pair) {
      check('different words: ' + pair.join(' / '), SL.isVariant(pair[0], pair[1]), false);
    });
  })

  /* Sweep: no two words a player could legitimately answer with should read
     as the same root. Seeds from words.js plus answers seen in real rounds. */
  .then(function () {
    var pool = ('obstruct bind squeeze intersect block arrest chafe pinch push wind ' +
      'wrench twist hurt carry lift kick rub shove hoist pick touch move blow whip ' +
      'paint prod punch flick flip lick slam brush tap tickle caress tip fling slap ' +
      'sling overturn stroke fondle pat pet grope grip press feel contact ' +
      'principle precept rationale rule maxim tenet dogma axiom creed ' +
      'discordant dissonant divisive factious harsh jarring strident ' +
      'resolve reset research settle decide determine ' +
      'gather temper yield plain curious grave sharp coarse sober candid earnest').split(' ');

    var collisions = [];
    for (var i = 0; i < pool.length; i++) {
      for (var j = i + 1; j < pool.length; j++) {
        if (SL.isVariant(pool[i], pool[j])) collisions.push(pool[i] + '/' + pool[j]);
      }
    }
    check('no legitimate answers collide as same root (' + pool.length + ' words)',
      collisions, []);
  })

  // ---- the entry limit ----
  .then(function () {
    var limited = SL.createGame({
      seed: 'touch', fetcher: fetcher, infoFetcher: infoFetcher,
      config: { guessLimit: 4 }
    });
    return limited.start()
      .then(function () { return limited.submit('contact'); })      // 1, lands
      .then(function (r) { check('limit: a word that lands spends an entry', r.left, 3); })
      .then(function () { return limited.submit('banana'); })       // 2, misses
      .then(function (r) { check('limit: a word that misses spends an entry', r.left, 2); })
      .then(function () { return limited.submit('touching'); })     // free: same root
      .then(function (r) {
        check('limit: a same-root word spends nothing', r.status, 'root');
        check('limit: entries left unchanged by a root word', limited.guessesLeft(), 2);
        return limited.submit('contact');                            // free: duplicate
      })
      .then(function () {
        check('limit: a duplicate spends nothing', limited.guessesLeft(), 2);
        return limited.submit('caress');                             // 3
      })
      .then(function () { return limited.submit('banana'); })        // 4, free retry but spends
      .then(function (r) {
        check('limit: a free retry still spends an entry', r.left, 0);
        check('limit: the round reports itself over', r.over, true);
        check('limit: engine agrees', limited.limitReached(), true);
        return limited.submit('feel');
      })
      .then(function (r) {
        check('limit: nothing is accepted afterwards', r.status, 'over');
        check('limit: the board is untouched', limited.counts()[1], 2);
      });
  })

  /* ---- every route in, not just the one BFS walked ----
     On a real "stark" board, several first-order words all linked to the
     same second-order one. Naming a single parent hid that. */
  .then(function () {
    console.log('\nall routes from the rung above');
    var maps = {
      stark:     { clear: { score: 40000000, syn: true },
                   plain: { score: 40000000, syn: true },
                   bare:  { score: 40000000, syn: true } },
      clear:     { unclouded: { score: 30000000, syn: false },
                   blinding:  { score: 30000000, syn: false } },
      plain:     { blinding: { score: 30000000, syn: false } },
      bare:      { blinding: { score: 30000000, syn: false } },
      unclouded: {}, blinding: {}
    };
    var g = SL.createGame({
      seed: 'stark',
      fetcher: function (w) { return Promise.resolve(maps[w] || {}); },
      infoFetcher: infoFetcher
    });
    function of(word) { return g.found().filter(function (e) { return e.word === word; })[0]; }

    return g.start()
      .then(function () { return g.submit('clear'); })
      .then(function () { return g.submit('blinding'); })
      .then(function () { return g.submit('unclouded'); })
      .then(function () {
        check('one route in is reported as one', of('blinding').parents, ['clear']);
        check('a first-order word points at the seed', of('clear').parents, ['stark']);
        return g.submit('plain');
      })
      .then(function () { return g.submit('bare'); })
      .then(function () {
        // slice() first: sort() would reorder the live array and break the
        // ordering assertion below.
        check('later finds add their routes',
          of('blinding').parents.slice().sort(), ['bare', 'clear', 'plain']);
        check('the scoring parent stays first', of('blinding').parents[0], 'clear');
        check('extra routes do not change the rung', of('blinding').depth, 2);
        check('a word with one route keeps one', of('unclouded').parents, ['clear']);
      });
  })

  /* ---- merging a second thesaurus ----
     Datamuse knows one synonym for "apocryphal"; Roget knows plenty. The
     merge has to add them without letting them outrank real synonyms. */
  .then(function () {
    console.log('\nmerging Moby with Datamuse');
    var datamuse = SL.parseRelated([
      { word: 'questionable', score: 39939535, tags: ['syn', 'adj'] },
      { word: 'apostrophal', score: 20024944, tags: ['adj'] }
    ]);
    var moby = ['spurious', 'fictitious', 'dubious', 'questionable',
                'out of the question', 'UNAUTHENTIC'];
    var merged = SL.mergeRelated(datamuse, moby);

    check('keeps what Datamuse already knew',
      merged.questionable.syn, true);
    check('a strong link is not downgraded by the merge',
      merged.questionable.score, 39939535);
    check('adds words Datamuse never heard of',
      ['spurious', 'fictitious', 'dubious'].every(function (w) { return !!merged[w]; }), true);
    check('added words are loose, not strong',
      [merged.spurious.syn, merged.spurious.score < SL.CONFIG.strongScore], [false, true]);
    check('added words still clear the acceptance floor',
      merged.spurious.score >= SL.CONFIG.minScore, true);
    check('they are marked as coming from the thesaurus',
      merged.spurious.moby, true);
    check('multi-word entries are dropped', merged['out of the question'], undefined);
    check('case is normalised', !!merged.unauthentic, true);
    check('the low-band tail survives untouched', merged.apostrophal.score, 20024944);

    var empty = SL.mergeRelated(datamuse, null);
    check('a missing thesaurus answer changes nothing',
      Object.keys(empty).sort(), ['apostrophal', 'questionable']);
    check('merging into nothing still works',
      Object.keys(SL.mergeRelated(null, ['alpha', 'beta'])).sort(), ['alpha', 'beta']);
  })

  /* The point of all that: a word the game used to reject now lands. */
  .then(function () {
    var thin = { questionable: { score: 39939535, syn: true } };
    var game = SL.createGame({
      seed: 'apocryphal',
      infoFetcher: infoFetcher,
      fetcher: function (w) {
        if (w === 'apocryphal') {
          return Promise.resolve(SL.mergeRelated(thin, ['spurious', 'fictitious', 'dubious']));
        }
        return Promise.resolve({});
      }
    });
    return game.start()
      .then(function () { return game.submit('spurious'); })
      .then(function (r) {
        check('"spurious" now lands on apocryphal',
          { status: r.status, depth: r.entry && r.entry.depth, quality: r.entry && r.entry.quality },
          { status: 'accepted', depth: 1, quality: 'loose' });
      });
  })

  // ---- request discipline: one lookup per distinct word, per game ----
  .then(function () {
    var log = [];
    var counted = SL.createGame({
      seed: 'touch',
      fetcher: function (w) { log.push(w); return fetcher(w); },
      infoFetcher: infoFetcher
    });
    return counted.start()
      .then(function () { return counted.submit('caress'); })
      .then(function () { return counted.submit('caress'); })   // duplicate
      .then(function () { return counted.submit('banana'); })
      .then(function () { return counted.submit('banana'); })   // retry
      .then(function () { return counted.submit('fondle'); })
      .then(function () {
        var unique = log.filter(function (w, i) { return log.indexOf(w) === i; });
        check('no word is looked up twice in a game', log.length, unique.length);
        check('lookups are one per word entered', log.sort(),
          ['banana', 'caress', 'fondle', 'touch']);
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
