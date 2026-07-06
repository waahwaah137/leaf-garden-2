// Curated word-banks + template skeletons for the template poet. Pure data, no logic.
//
// The poet (poet.ts) buckets the live leaf signals + sound bank + daytime phase, then assembles a
// grammar from these tables and expands a structure template. Each array is roughly ordered
// "common/safe → rarer/wilder"; the poet slices deeper into each list as the Creativity dial rises
// (this mirrors LLM temperature, so the same control transfers when an LLM source lands later).

import type { DaytimePhase } from '../env/daytime';

/** The four sound-bank groups from banks.ts — each speaks in its own register. */
export type BankGroup = 'Spacey' | 'Organic' | 'Crystalline' | 'Electronic';

/** Coarse hue families (green-weighted, since the ExG plant mask skews the palette green). */
export type HueBucket = 'green' | 'lime' | 'gold' | 'amber' | 'red' | 'blue' | 'violet' | 'pale';

// --- Signal-derived words -------------------------------------------------------------------------

export const COLOR_WORDS: Record<HueBucket, string[]> = {
  green: ['green', 'verdant', 'moss-dark', 'jade', 'emerald', 'chlorophyll'],
  lime: ['lime', 'chartreuse', 'new-leaf', 'acid-bright', 'spring-green'],
  gold: ['gold', 'yellow', 'honeyed', 'sunlit', 'brass'],
  amber: ['amber', 'ochre', 'rust', 'burnished', 'marigold'],
  red: ['red', 'crimson', 'ember', 'blood-bright', 'garnet'],
  blue: ['blue', 'cool', 'slate', 'dusk-blue', 'cyanotype'],
  violet: ['violet', 'plum', 'bruise-dark', 'amethyst', 'iris'],
  pale: ['pale', 'washed', 'silvered', 'ghost-grey', 'bone'],
};

export const FORM_ROUND: string[] = ['round', 'soft', 'cupped', 'curled', 'furled', 'moon-round'];
export const FORM_JAGGED: string[] = ['jagged', 'splayed', 'serrated', 'sharp', 'frayed', 'toothed'];

export const VIVID_LOW: string[] = ['muted', 'faint', 'pale', 'quiet', 'half-there'];
export const VIVID_HIGH: string[] = ['vivid', 'burning', 'saturated', 'blazing', 'loud'];

export const SCALE_SPARSE: string[] = ['a single leaf', 'one lone frond', 'a solitary blade', 'a stray leaf'];
export const SCALE_DENSE: string[] = ['a thicket', 'a crowd of leaves', 'a green riot', 'a tangle', 'a canopy'];

// --- Register per bank group (the "voice" of the music) -------------------------------------------

export interface Register {
  nouns: string[]; // concrete nouns the voice reaches for
  verbs: string[]; // motion/being verbs
  adjs: string[]; // atmosphere adjectives
  moods: string[]; // abstract mood nouns
}

export const REGISTERS: Record<BankGroup, Register> = {
  Organic: {
    nouns: ['loam', 'moss', 'root', 'bark', 'sap', 'humus', 'fern'],
    verbs: ['unfurls', 'breathes', 'roots', 'creeps', 'settles', 'greens'],
    adjs: ['earthen', 'damp', 'growing', 'patient', 'low'],
    moods: ['stillness', 'growth', 'rest', 'the slow hour'],
  },
  Crystalline: {
    nouns: ['chime', 'frost', 'glass', 'facet', 'prism', 'icicle', 'bell'],
    verbs: ['rings', 'splinters', 'refracts', 'shivers', 'glitters', 'chimes'],
    adjs: ['brittle', 'clear', 'cut', 'cold-bright', 'fragile'],
    moods: ['clarity', 'a held breath', 'the thin light', 'sharpness'],
  },
  Spacey: {
    nouns: ['void', 'star', 'drift', 'orbit', 'dark', 'comet', 'distance'],
    verbs: ['drifts', 'expands', 'hangs', 'wanders', 'dissolves', 'floats'],
    adjs: ['vast', 'slow', 'weightless', 'endless', 'far'],
    moods: ['vastness', 'the long dark', 'silence', 'the deep'],
  },
  Electronic: {
    nouns: ['pulse', 'current', 'neon', 'signal', 'wire', 'grid', 'circuit'],
    verbs: ['pulses', 'flickers', 'hums', 'loops', 'sparks', 'cycles'],
    adjs: ['electric', 'restless', 'bright-wired', 'humming', 'charged'],
    moods: ['momentum', 'a live wire', 'the loop', 'restlessness'],
  },
};

// --- Time-of-day words ----------------------------------------------------------------------------

// `light` words must NOT begin with an article — templates supply "the"/"in the" themselves.
export const PHASE_WORDS: Record<DaytimePhase, { light: string[]; mood: string[] }> = {
  dawn: { light: ['first light', 'grey dawn', 'cold morning'], mood: ['waking', 'a new page', 'the hush before'] },
  day: { light: ['full daylight', 'bright noon', 'open sun'], mood: ['plainness', 'the long day', 'clarity'] },
  golden: { light: ['golden hour', 'low gold light', 'amber slant'], mood: ['warmth', 'the softening', 'a slow gold'] },
  dusk: { light: ['dusk', 'failing light', 'blue evening'], mood: ['ending', 'the turn inward', 'a quiet closing'] },
  night: { light: ['night', 'dark', 'starless black'], mood: ['secrecy', 'the deep hour', 'sleep'] },
};

// --- Structure templates --------------------------------------------------------------------------
//
// Templates reference grammar symbols the poet fills in: #color# #form# #vivid# #scale# #rnoun#
// #rverb# #radj# #rmood# #light# #pmood#. Each entry is one structure's set of alternative skeletons;
// the poet picks one and expands it. `line` = one line; `couplet` = two; `haiku` = three (the poet
// nudges these toward 5-7-5 via a syllable estimator, so keep them short and swappable).

export const TEMPLATES: Record<'line' | 'couplet' | 'haiku', string[]> = {
  line: [
    '#scale#, #color# and #form#, #rverb#.',
    'the #rnoun# #rverb# — #color#, #radj#.',
    '#form#, #vivid#: #scale# in the #light#.',
    'here, #rmood# — and a #color# leaf.',
  ],
  couplet: [
    '#scale#, #form# and #color#.\n#rnoun# #rverb# toward #rmood#.',
    'in the #light#, #color# and #radj#;\na leaf #rverb#, and I stay a while.',
    '#vivid# green, #form# against the sky —\n#rnoun# #rverb#, #radj# and slow.',
  ],
  haiku: [
    '#color# #form# leaf\n#rnoun# #rverb# in #light#\n#rmood# stays behind',
    '#scale# waiting\n#radj# and #vivid# it #rverb#\nthe #light# goes on',
    'a #color# frond\n#rverb# where the #rnoun# is —\n#pmood#, then still',
  ],
};
