/* Word lists for Synonym Ladder.
   Each seed word was picked for having a reasonably rich synonym neighbourhood
   in the Datamuse / WordNet data the game queries at runtime.
   Add or remove words freely - nothing else needs to change. */

/* Tier keys stay 'easy' / 'medium' / 'hard' internally so saved rounds and
   older ?tier= links keep working. Only the labels below are shown. */
window.TIER_LABELS = {
  easy: 'simple',
  medium: 'literary',
  hard: 'erudite'
};

/* Anything a URL might arrive with, mapped back to a tier key. */
window.TIER_ALIASES = {
  simple: 'easy', easy: 'easy',
  literary: 'medium', medium: 'medium',
  erudite: 'hard', hard: 'hard'
};

window.WORDS = {
  // simple
  easy: [
    'touch', 'walk', 'big', 'happy', 'break', 'cold',
    'quiet', 'look', 'throw', 'angry', 'small', 'funny',
    'fast', 'strong', 'clean', 'hard'
  ],
  // literary
  medium: [
    'principle', 'obscure', 'resolve', 'gather', 'temper', 'yield',
    'plain', 'curious', 'grave', 'restrain', 'decline', 'sharp',
    'coarse', 'sober', 'candid', 'earnest'
  ],
  // erudite
  hard: [
    'discordant', 'obdurate', 'laconic', 'ephemeral', 'truculent',
    'sanguine', 'recondite', 'fastidious', 'capricious', 'perfidious',
    'turgid', 'querulous', 'inchoate', 'desultory', 'trenchant', 'lugubrious'
  ]
};

/* The daily puzzle rotates through this list. Day of the week sets the tier,
   so the week ramps up in difficulty. Everyone gets the same word on the
   same UTC date. */
window.DAILY_TIER_BY_WEEKDAY = [
  'easy',   // Sunday    - simple
  'easy',   // Monday    - simple
  'medium', // Tuesday   - literary
  'medium', // Wednesday - literary
  'medium', // Thursday  - literary
  'hard',   // Friday    - erudite
  'hard'    // Saturday  - erudite
];
