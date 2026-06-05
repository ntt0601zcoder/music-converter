import { describe, it, expect } from 'vitest';
import { mergeRepeatedNotes, type TimedNote } from './notesPostprocess';

function note(start: number, dur: number, pitch: number): TimedNote {
  return { startTimeSeconds: start, durationSeconds: dur, pitchMidi: pitch, amplitude: 0.8 };
}

describe('mergeRepeatedNotes', () => {
  it('merges same-pitch notes separated by a tiny gap into one', () => {
    const merged = mergeRepeatedNotes(
      [note(0, 0.2, 60), note(0.22, 0.2, 60), note(0.45, 0.2, 60)],
      0.09,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].startTimeSeconds).toBe(0);
    expect(merged[0].durationSeconds).toBeCloseTo(0.65, 5); // spans to last note's end
  });

  it('keeps same-pitch notes that are clearly separate', () => {
    const merged = mergeRepeatedNotes([note(0, 0.2, 60), note(0.6, 0.2, 60)], 0.09);
    expect(merged).toHaveLength(2);
  });

  it('never merges different pitches', () => {
    const merged = mergeRepeatedNotes([note(0, 0.2, 60), note(0.21, 0.2, 64)], 0.09);
    expect(merged).toHaveLength(2);
  });

  it('merges overlapping same-pitch notes', () => {
    const merged = mergeRepeatedNotes([note(0, 0.3, 67), note(0.1, 0.3, 67)], 0.09);
    expect(merged).toHaveLength(1);
    expect(merged[0].durationSeconds).toBeCloseTo(0.4, 5);
  });

  it('returns notes sorted by time then pitch', () => {
    const merged = mergeRepeatedNotes([note(1, 0.2, 72), note(0, 0.2, 60), note(0, 0.2, 64)], 0.09);
    expect(merged.map((n) => [n.startTimeSeconds, n.pitchMidi])).toEqual([
      [0, 60],
      [0, 64],
      [1, 72],
    ]);
  });
});
