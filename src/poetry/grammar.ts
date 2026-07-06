// A tiny Tracery-style grammar expander (author-focused generative text). Zero-dep, offline.
//
// A grammar is a map of symbol -> array of expansion rules. A rule is a plain string that may
// contain `#symbol#` references, which are recursively replaced by a randomly-chosen expansion of
// that symbol. Unknown symbols expand to empty string (so optional slots can be left undefined).
//
// This is deliberately minimal — no modifiers/actions like full Tracery — because our lexicons only
// need weighted random selection + nesting. Determinism comes from an injected RNG so a given seed
// always yields the same poem (used to make each tap/leaf reproducible).

export type Grammar = Record<string, string[]>;

/** 0..1 random source. Inject a seeded RNG (see mulberry32) for reproducible output. */
export type Rng = () => number;

const SYMBOL = /#([a-zA-Z0-9_]+)#/g;
const MAX_DEPTH = 24; // guard against accidental infinite recursion in a grammar

/** Picks a uniformly-random element of `arr` using `rng`. */
export function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/**
 * Expands `start` (e.g. "#origin#" or a literal template with #refs#) against `grammar`.
 * References to missing/empty symbols collapse to "". Whitespace is left as-authored except that
 * the final result is trimmed and internal runs of spaces are collapsed (so optional slots that
 * expand to nothing don't leave double spaces).
 */
export function expand(grammar: Grammar, start: string, rng: Rng, depth = 0): string {
  if (depth > MAX_DEPTH) return '';
  const out = start.replace(SYMBOL, (_, symbol: string) => {
    const rules = grammar[symbol];
    if (!rules || rules.length === 0) return '';
    return expand(grammar, pick(rules, rng), rng, depth + 1);
  });
  return depth === 0 ? out.replace(/\s+/g, ' ').trim() : out;
}

/** Deterministic 32-bit PRNG (mulberry32). Same seed → same stream; fast and dependency-free. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
