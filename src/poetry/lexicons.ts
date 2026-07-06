// Curated word-banks + template skeletons for the template poet. Pure data, no logic.
//
// VOICE: grounded in Cubbon Park, Bengaluru — the app's home. Warm, monsoon-soaked, tropical;
// never frost/snow/cold. Drawn from the park's own life (rain trees, teak, silver oak, banyan,
// gulmohar, jacaranda; parakeets, mynahs, black kites, palm squirrels, cicadas) and the register of
// the user's essay "Tree Crutches" — slowness, shade, holding/being held, canopies planted long
// before you, "shade before roads." See daytime.ts for the time-of-day phases these pair with.
//
// The poet (poet.ts) buckets the live leaf signals + sound bank + daytime phase, then assembles a
// grammar from these tables and expands a structure template. Each array is ordered "common/safe →
// rarer/wilder": the poet's `widen()` slices from the FRONT (2 entries → full as the Creativity dial
// rises), so keep the first two of every list short and natural. Words stay lowercase (the poet
// capitalizes line-starts and fixes "a/an"); `light` words must not begin with an article and
// `rnoun` words must not begin with "the" (templates supply those).

import type { DaytimePhase } from '../env/daytime';

/** The four sound-bank groups from banks.ts — each speaks in its own register. */
export type BankGroup = 'Spacey' | 'Organic' | 'Crystalline' | 'Electronic';

/** Coarse hue families (green-weighted, since the ExG plant mask skews the palette green). */
export type HueBucket = 'green' | 'lime' | 'gold' | 'amber' | 'red' | 'blue' | 'violet' | 'pale';

// --- Signal-derived words -------------------------------------------------------------------------

export const COLOR_WORDS: Record<HueBucket, string[]> = {
  green: ['green', 'verdant', 'canopy-green', 'moss-dark', 'jade', 'rain-washed'],
  lime: ['lime', 'new-leaf', 'tender', 'sunlit-green', 'young-frond', 'chartreuse'],
  gold: ['gold', 'sunlit', 'honeyed', 'pollen-gold', 'brass', 'gulmohar-gold'],
  amber: ['amber', 'ochre', 'rust', 'laterite', 'tamarind', 'marigold'],
  red: ['red', 'crimson', 'ember', 'flame-tree', 'gulmohar-red', 'vermilion'],
  blue: ['blue', 'slate', 'monsoon-grey', 'dusk-blue', 'kingfisher', 'storm-blue'],
  violet: ['violet', 'plum', 'jacaranda', 'amethyst', 'iris', 'dusk-violet'],
  pale: ['pale', 'washed', 'misted', 'silver-oak', 'dust-pale', 'bone'],
};

export const FORM_ROUND: string[] = ['round', 'soft', 'broad', 'cupped', 'folded', 'palm-round'];
export const FORM_JAGGED: string[] = ['jagged', 'splayed', 'serrated', 'sharp', 'frond-split', 'fern-cut'];

export const VIVID_LOW: string[] = ['muted', 'faint', 'shade-dim', 'quiet', 'half-there'];
export const VIVID_HIGH: string[] = ['vivid', 'sunlit', 'saturated', 'blazing', 'monsoon-bright'];

export const SCALE_SPARSE: string[] = ['a single leaf', 'one fallen frond', 'a lone seed-pod', 'a stray blossom'];
export const SCALE_DENSE: string[] = ['the canopy', 'a grove', 'a crowd of leaves', 'the rain-tree shade', 'a tangle of roots'];

// --- Register per bank group (the "voice" of the music) -------------------------------------------

export interface Register {
  nouns: string[]; // concrete nouns the voice reaches for (must not begin with "the")
  verbs: string[]; // motion/being verbs
  adjs: string[]; // atmosphere adjectives
  moods: string[]; // abstract mood nouns (may begin with the/a)
}

export const REGISTERS: Record<BankGroup, Register> = {
  Organic: {
    nouns: ['root', 'bark', 'rain-tree', 'banyan', 'loam', 'moss', 'red earth', 'seed'],
    verbs: ['unfurls', 'roots', 'leans', 'greens', 'holds', 'shades', 'breathes', 'drips'],
    adjs: ['earthen', 'rain-damp', 'patient', 'shaded', 'ancient', 'low'],
    moods: ['stillness', 'shade', 'the slow hour', 'old growth', 'shelter'],
  },
  // Reframed away from weather-cold: chime/glass/dew as *texture and light*, not ice.
  Crystalline: {
    nouns: ['dew', 'chime', 'birdcall', 'bead', 'glass-light', 'bell', 'prism'],
    verbs: ['rings', 'glints', 'beads', 'chimes', 'trembles', 'catches'],
    adjs: ['clear', 'dew-bright', 'glassy', 'fine', 'ringing', 'bright'],
    moods: ['clarity', 'a held note', 'the bright air', 'first birdsong', 'sharpness'],
  },
  // The cathedral hush of old canopy — "you stop being the most important thing in the room."
  Spacey: {
    nouns: ['canopy', 'hush', 'shade', 'old-dark', 'height', 'distance'],
    verbs: ['towers', 'drifts', 'hushes', 'opens', 'dwarfs', 'stills'],
    adjs: ['vast', 'ancient', 'high', 'endless', 'cool-shaded', 'deep'],
    moods: ['vastness', 'the long shade', 'the deep hush', 'standing small', 'the deep'],
  },
  // The city held at the park's edge — "a forest is what the trees keep out."
  Electronic: {
    nouns: ['cicada', 'city-hum', 'current', 'pulse', 'wire', 'edge'],
    verbs: ['thrums', 'pulses', 'buzzes', 'loops', 'hums', 'presses'],
    adjs: ['electric', 'restless', 'humming', 'charged', 'city-bright'],
    moods: ['momentum', 'the held city', 'the buzzing hour', 'restlessness', 'the loop'],
  },
};

// --- Time-of-day words ----------------------------------------------------------------------------

// Bengaluru light, not a cold clime. `light` words must NOT begin with an article — templates supply
// "the"/"in the" themselves.
export const PHASE_WORDS: Record<DaytimePhase, { light: string[]; mood: string[] }> = {
  dawn: { light: ['first light', 'misted morning', 'monsoon dawn'], mood: ['waking', 'birdsong', 'the hush before'] },
  day: { light: ['open sun', 'bright noon', 'humid light'], mood: ['the long day', 'heat-stilled', 'shade-seeking'] },
  golden: { light: ['golden hour', 'low gold light', 'slant through the rain-trees'], mood: ['warmth', 'the softening', 'a slow gold'] },
  dusk: { light: ['dusk', 'blue evening', 'falling light'], mood: ['the turn inward', 'parrots home', 'a quiet closing'] },
  night: { light: ['night', 'cicada-dark', 'dark canopy'], mood: ['the deep hour', 'fruit-bat wing', 'sleep'] },
};

// --- Cubbon place-lore ----------------------------------------------------------------------------
//
// Every poem braids a leaf strand (the camera-seeded words above) with a *place strand* from these
// banks: the park's history, botany, buildings, birds, people, and the ambivalent politics of its
// canopy. Naming is mostly oblique (roles/epochs), with a few real names surfacing only as the
// Creativity dial widens (so proper names sit at the END of FIGURES). Proper nouns keep their
// capitals (the poet only capitalizes line-starts, never lowercases). Grounded in the park's real
// history and the user's essay "Tree Crutches" — contemplative, non-partisan.

// Oblique-first; the named few (Kempe Gowda 1537; Tipu + Lalbagh; Krumbiegel, the German
// horticulturist interned as an "enemy" in WWII) surface rarely.
export const FIGURES: string[] = [
  'the old commissioner',
  'the last commissioner',
  'the sultan',
  'the German gardener',
  'the chieftain',
  'the enemy gardener',
  'Kempe Gowda',
  'Tipu',
  'Krumbiegel',
];

export const EPOCHS: string[] = [
  'before the roads',
  'before the fort',
  'under the sultans',
  'in the Raj',
  'after the empire',
  'since the mud fort',
];

// Imperial botany: an avenue assembled from across an empire. Warm variant leads with the red
// gulmohar so a red camera reading nudges the poem toward it (see poet.buildGrammar).
export const TREES: string[] = [
  'the rain tree',
  'the silver oak',
  'the old fig',
  'the teak',
  'the mahogany',
  'the java fig',
  'the gulmohar',
  'the bamboo',
];
export const TREES_WARM: string[] = [
  'the gulmohar',
  'the flame tree',
  'the rain tree',
  'the silver oak',
  'the teak',
  'the old fig',
  'the mahogany',
  'the bamboo',
];
export const TSTATE: string[] = [
  'leans',
  'holds the shade',
  'was planted by hand',
  'outlives them',
  'keeps the heat out',
  'wears its crutch',
  'drops its red',
];

// The park's living cast (plural, so subject-verb agreement stays clean).
export const FOLK: string[] = [
  'walkers',
  'runners',
  'lovers',
  'readers',
  'skaters',
  'children',
  'the black-robed',
  'the Sunday crowd',
];
export const FVERB: string[] = ['circle', 'gather', 'linger', 'race', 'scatter', 'trespass', 'come anyway'];

export const BIRDS: string[] = ['crows', 'parakeets', 'mynahs', 'kites', 'koels'];
export const BVERB: string[] = ['wheel', 'settle', 'scatter', 'call', 'gather', 'cross the red'];

// Object noun-phrases — only ever used after a preposition (over/past/beyond/near), so any pairing
// reads: "past the red library", "over the bamboo grove".
export const LANDMARK: string[] = [
  'the red library',
  'the high court',
  'the bandstand',
  'the bamboo grove',
  'the stone kings',
  'the caged door',
];

// Curated subject clauses (the two red buildings, the statues greening over). Warm variant leads
// with the red buildings.
export const PLACE: string[] = [
  'the bandstand holds an old silence',
  'the stone kings green over',
  'the bamboo grove leans and creaks',
  'the red library keeps its dust',
  'the high court reddens under crows',
  'the caged door stays half-shut',
];
export const PLACE_WARM: string[] = [
  'the high court reddens under crows',
  'the red library keeps its dust',
  'the caged door stays half-shut',
  'the bandstand holds an old silence',
  'the stone kings green over',
  'the bamboo grove leans and creaks',
];

// The canopy's politics, in the essay's ambivalent voice. Short → long, so the haiku syllable
// optimizer can reach for the brief ones on tight lines.
export const LORE: string[] = [
  'held, not owned',
  'shade before roads',
  'caged and open at once',
  'care or the chainsaw',
  'what the trees keep out',
  'they cut, we come anyway',
  'one removal order at a time',
  'the friction is the point',
  'you are not the most important thing here',
];

// --- Structure templates --------------------------------------------------------------------------
//
// Templates reference grammar symbols the poet fills in — leaf strand: #color# #form# #vivid# #scale#
// #rnoun# #rverb# #radj# #rmood# #light# #pmood#; place strand: #tree# #tstate# #folk# #fverb# #bird#
// #bverb# #landmark# #place# #lore# #figure# #epoch#. EVERY skeleton braids at least one camera-seeded
// leaf word with at least one place strand. `line` = one line; `couplet` = two; `haiku` = three (the
// poet nudges these toward 5-7-5 via a syllable estimator, so keep them short and swappable).

export const TEMPLATES: Record<'line' | 'couplet' | 'haiku', string[]> = {
  line: [
    '#scale#, #color# and #form# — #lore#.',
    '#tree# #tstate#; a #color# leaf, #radj#.',
    '#bird# #bverb# past #landmark# — #color#, #form#.',
    '#place#; #scale# in the #light#.',
    '#epoch#, #color# and #form#.',
    '#figure# is gone; a #color# #form# leaf stays.',
  ],
  couplet: [
    '#scale#, #form# and #color# —\n#place#, and #folk# #fverb#.',
    'in the #light#, #color# and #radj#;\n#tree# #tstate#, #lore#.',
    'a #color# leaf, #vivid# and #form#;\n#bird# #bverb# past #landmark#.',
    '#epoch#, #scale# and #color#;\n#figure# is gone, the shade stays.',
    '#color# against the shade, #form# —\n#place#; #lore#.',
  ],
  haiku: [
    '#color# #form# leaf\n#tree# #tstate# in #light#\n#lore#',
    '#scale# waiting\n#folk# #fverb# past #landmark#\n#bird# #bverb#',
    '#place#\na #color# frond #rverb#\n#lore#',
    '#color# and #form#\n#figure# planted this shade\n#bird# #bverb#',
  ],
};
