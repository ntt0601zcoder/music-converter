// Music-theory helpers: MIDI pitch <-> notation spelling, key signatures.

export interface SpelledPitch {
  /** Note letter A–G. */
  step: string;
  /** Chromatic alteration: -1 flat, 0 natural, +1 sharp. */
  alter: number;
  /** Scientific octave (C4 = middle C = MIDI 60). */
  octave: number;
}

// Sharp and flat spellings of the 12 pitch classes.
const SHARP_SPELLING: ReadonlyArray<[string, number]> = [
  ['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0],
  ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0],
];
const FLAT_SPELLING: ReadonlyArray<[string, number]> = [
  ['C', 0], ['D', -1], ['D', 0], ['E', -1], ['E', 0], ['F', 0],
  ['G', -1], ['G', 0], ['A', -1], ['A', 0], ['B', -1], ['B', 0],
];

/**
 * Spell a MIDI pitch as letter/alter/octave. `useFlats` chooses enharmonic
 * spelling (driven by the key signature: flat keys prefer flats).
 */
export function spellMidi(midi: number, useFlats = false): SpelledPitch {
  const pc = ((midi % 12) + 12) % 12;
  const [step, alter] = (useFlats ? FLAT_SPELLING : SHARP_SPELLING)[pc];
  // Octave is computed from the *letter*, so e.g. Cb stays in the right octave.
  // For our sharp/flat tables the letter never crosses an octave boundary
  // except Cb/B#, which we don't emit, so the simple formula is correct.
  const octave = Math.floor(midi / 12) - 1;
  return { step, alter, octave };
}

/** Number of sharps (+) or flats (-) for a major key, by tonic pitch class. */
export const MAJOR_KEY_FIFTHS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};

/** A key signature with negative fifths (flats) prefers flat spelling. */
export function keyUsesFlats(fifths: number): boolean {
  return fifths < 0;
}

export const MIDDLE_C = 60;

export function midiToNoteName(midi: number, useFlats = false): string {
  const { step, alter, octave } = spellMidi(midi, useFlats);
  const acc = alter === 1 ? '#' : alter === -1 ? 'b' : '';
  return `${step}${acc}${octave}`;
}
