// The template poet: turns live leaf signals + sound-bank register + daytime phase into short,
// whimsical lines. Kept free of any Tone/DOM imports so it runs in a plain node sandbox check and so
// the grammar stays a pure function of its inputs.
//
// LLM SEAM: `PoetrySource` is the interface a future in-browser LLM (SmolLM-360M in a WebGPU Web
// Worker) will implement. `TemplatePoet` is the always-available, offline, zero-download default;
// `createPoet()` returns the active source (template today). `opts.creativity` widens word choice
// here and will map to LLM temperature there, so the Creativity dial transfers unchanged.

import type { DaytimePhase } from '../env/daytime';
import { clamp, lerp } from '../utils/math';
import { expand, mulberry32, pick, type Grammar, type Rng } from './grammar';
import {
  COLOR_WORDS,
  FORM_JAGGED,
  FORM_ROUND,
  PHASE_WORDS,
  REGISTERS,
  SCALE_DENSE,
  SCALE_SPARSE,
  TEMPLATES,
  VIVID_HIGH,
  VIVID_LOW,
  type BankGroup,
  type HueBucket,
} from './lexicons';

export type Structure = 'line' | 'couplet' | 'haiku';

export interface PoetryInput {
  hueDeg: number; // 0-360 circular-mean hue of the leaf/frame
  shape: number; // 0 round/compact .. 1 jagged/elongated
  colorSignal: number; // 0-1 vividness
  presence: number; // 0-1 plant presence
  leafCount: number; // tracked leaves in view
  group: BankGroup; // the active sound bank's group → the voice
  phase: DaytimePhase; // time-of-day
  seed: number; // reproducible-per-tap variation
}

export interface GenerateOpts {
  structure: Structure;
  creativity: number; // 0-1
}

/** The pluggable text source. Template now; LLM later — same signature, same call site. */
export interface PoetrySource {
  generate(input: PoetryInput, opts: GenerateOpts): Promise<string[]>;
}

const HAIKU_TARGET = [5, 7, 5];
const HAIKU_CANDIDATES = 6; // pick the closest-to-5-7-5 of this many deterministic attempts

/** Buckets a hue angle into a coarse colour family; very-desaturated frames read as "pale". */
export function bucketHue(hueDeg: number, colorSignal: number): HueBucket {
  if (colorSignal < 0.12) return 'pale';
  const h = ((hueDeg % 360) + 360) % 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'amber';
  if (h < 70) return 'gold';
  if (h < 90) return 'lime';
  if (h < 160) return 'green';
  if (h < 250) return 'blue';
  return 'violet';
}

/** Takes the first N entries of a bank, N growing from 2 → full length as creativity rises. */
function widen<T>(arr: readonly T[], creativity: number): T[] {
  const n = clamp(Math.round(lerp(2, arr.length, creativity)), 2, arr.length);
  return arr.slice(0, n);
}

/** Vowel-group syllable estimate (rough, English-ish) — used only to nudge haiku line lengths. */
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g);
  let n = groups ? groups.length : 1;
  if (w.length > 2 && w.endsWith('e')) n = Math.max(1, n - 1); // silent trailing e
  return Math.max(1, n);
}

function lineSyllables(line: string): number {
  return line
    .split(/\s+/)
    .filter(Boolean)
    .reduce((sum, word) => sum + countSyllables(word), 0);
}

function haikuError(lines: string[]): number {
  let err = 0;
  for (let i = 0; i < HAIKU_TARGET.length; i++) {
    err += Math.abs((lines[i] ? lineSyllables(lines[i]) : 0) - HAIKU_TARGET[i]);
  }
  return err;
}

function capitalizeFirst(line: string): string {
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : line;
}

/** "a ember" → "an ember". Safe for our controlled vowel-initial vocabulary (no silent-h edge cases). */
function fixArticles(line: string): string {
  return line.replace(/\b([Aa]) (?=[aeiouAEIOU])/g, (_, a: string) => (a === 'A' ? 'An ' : 'an '));
}

/** Builds the grammar symbol table from the bucketed signals, register, and phase. */
function buildGrammar(input: PoetryInput, creativity: number): Grammar {
  const hueBucket = bucketHue(input.hueDeg, input.colorSignal);
  const reg = REGISTERS[input.group];
  const phaseWords = PHASE_WORDS[input.phase];

  const formBase = input.shape < 0.5 ? FORM_ROUND : FORM_JAGGED;
  const formOther = input.shape < 0.5 ? FORM_JAGGED : FORM_ROUND;
  // At high creativity, let a hint of the opposite form leak in for surprise.
  const form = creativity > 0.6 ? [...widen(formBase, creativity), formOther[0]] : widen(formBase, creativity);

  const dense = input.leafCount >= 3 || input.presence > 0.25;
  const vivid = input.colorSignal >= 0.5 ? VIVID_HIGH : VIVID_LOW;

  return {
    color: widen(COLOR_WORDS[hueBucket], creativity),
    form,
    vivid: widen(vivid, creativity),
    scale: widen(dense ? SCALE_DENSE : SCALE_SPARSE, creativity),
    rnoun: widen(reg.nouns, creativity),
    rverb: widen(reg.verbs, creativity),
    radj: widen(reg.adjs, creativity),
    rmood: widen(reg.moods, creativity),
    light: widen(phaseWords.light, creativity),
    pmood: widen(phaseWords.mood, creativity),
  };
}

/** Expands one template for the given structure into an array of (capitalized) lines. */
function composeOnce(grammar: Grammar, structure: Structure, rng: Rng): string[] {
  const template = pick(TEMPLATES[structure], rng);
  return expandToLines(grammar, template, rng);
}

function expandToLines(grammar: Grammar, template: string, rng: Rng): string[] {
  // Expand line-by-line so the grammar's whole-string whitespace collapse doesn't merge lines.
  return template
    .split('\n')
    .map((line) => capitalizeFirst(fixArticles(expand(grammar, line, rng))))
    .filter((l) => l.length > 0);
}

export class TemplatePoet implements PoetrySource {
  generate(input: PoetryInput, opts: GenerateOpts): Promise<string[]> {
    const creativity = clamp(opts.creativity, 0, 1);
    const rng = mulberry32(input.seed);
    const grammar = buildGrammar(input, creativity);

    if (opts.structure !== 'haiku') {
      return Promise.resolve(composeOnce(grammar, opts.structure, rng));
    }

    // Haiku: generate several deterministic candidates, keep the closest to 5-7-5.
    let best: string[] = [];
    let bestErr = Infinity;
    for (let i = 0; i < HAIKU_CANDIDATES; i++) {
      const candidate = composeOnce(grammar, 'haiku', rng);
      const err = haikuError(candidate);
      if (err < bestErr) {
        bestErr = err;
        best = candidate;
      }
    }
    return Promise.resolve(best);
  }
}

/** Returns the active poetry source. Template today; feature-detect an LLM source here later. */
export function createPoet(): PoetrySource {
  return new TemplatePoet();
}
