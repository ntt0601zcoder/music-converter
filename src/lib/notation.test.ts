import { describe, it, expect } from 'vitest';
import { quantizeScore, DEFAULT_SCORE_SETTINGS, type ScoreSettings } from './quantize';
import { scoreToMusicXml } from './musicxml';
import { notesToMidiBytes } from './midi';
import type { NoteEventTime } from './transcribe';

function note(
  startTimeSeconds: number,
  durationSeconds: number,
  pitchMidi: number,
): NoteEventTime {
  return { startTimeSeconds, durationSeconds, pitchMidi, amplitude: 0.8 };
}

// tempo 120 => quarter = 0.5s, grid 16th = 0.125s/unit, 4/4 measure = 16 units.
const SETTINGS: ScoreSettings = { ...DEFAULT_SCORE_SETTINGS, tempo: 120 };

function sumMeasureDurations(score: ReturnType<typeof quantizeScore>): void {
  for (const staff of score.staves) {
    staff.measures.forEach((measure, mIdx) => {
      const total = measure.reduce((s, el) => s + el.durationUnits, 0);
      expect(
        total,
        `staff ${staff.clef} measure ${mIdx + 1} should fill exactly one bar`,
      ).toBe(score.divisionsPerMeasure);
    });
  }
}

describe('quantizeScore', () => {
  it('fills every measure exactly (no overfull/underfull bars)', () => {
    const notes: NoteEventTime[] = [
      note(0, 0.5, 60), // C4 quarter
      note(0.5, 0.5, 64), // E4 quarter
      note(1.0, 1.0, 67), // G4 half
      note(0, 2.0, 48), // C3 spanning the whole bar (bass)
      note(1.5, 1.0, 50), // D3 crossing the barline (12->20 units)
    ];
    const score = quantizeScore(notes, SETTINGS);
    expect(score.divisionsPerMeasure).toBe(16);
    expect(score.staves).toHaveLength(2); // grand staff
    sumMeasureDurations(score);
  });

  it('creates a tie across a barline', () => {
    // D3 from 1.5s (unit 12) for 1.0s (8 units) -> 12..20, crosses bar at 16.
    const score = quantizeScore([note(1.5, 1.0, 50)], SETTINGS);
    const anyTieStart = score.staves
      .flatMap((s) => s.measures.flat())
      .some((el) => el.tieStart);
    expect(anyTieStart).toBe(true);
  });

  it('handles empty input with a single full-measure rest', () => {
    const score = quantizeScore([], SETTINGS);
    sumMeasureDurations(score);
    const allRests = score.staves.flatMap((s) => s.measures.flat()).every((el) => el.isRest);
    expect(allRests).toBe(true);
  });

  it('melody mode produces a single staff', () => {
    const score = quantizeScore([note(0, 0.5, 67)], { ...SETTINGS, mode: 'melody' });
    expect(score.staves).toHaveLength(1);
    sumMeasureDurations(score);
  });

  it('fills bars in odd meters (3/4, 6/8)', () => {
    for (const [beats, beatType] of [
      [3, 4],
      [6, 8],
      [2, 2],
    ] as const) {
      const score = quantizeScore(
        [note(0, 0.5, 60), note(0.75, 0.75, 64), note(2.0, 0.5, 67)],
        { ...SETTINGS, beats, beatType },
      );
      sumMeasureDurations(score);
    }
  });
});

describe('scoreToMusicXml', () => {
  it('produces well-formed MusicXML with measures and pitches', () => {
    const score = quantizeScore([note(0, 0.5, 60), note(0.5, 0.5, 64)], SETTINGS);
    const xml = scoreToMusicXml(score, { title: 'Test' });
    expect(xml).toContain('<score-partwise');
    expect(xml).toContain('<work-title>Test</work-title>');
    expect(xml).toContain('<divisions>4</divisions>');
    expect(xml).toContain('<step>C</step>');
    expect(xml.match(/<measure /g)?.length).toBe(score.numberOfMeasures);
  });

  it('escapes XML special characters in the title', () => {
    const score = quantizeScore([note(0, 0.5, 60)], SETTINGS);
    const xml = scoreToMusicXml(score, { title: 'A & B <x>' });
    expect(xml).toContain('A &amp; B &lt;x&gt;');
  });
});

describe('notesToMidiBytes', () => {
  it('produces a valid SMF header', () => {
    const bytes = notesToMidiBytes([note(0, 0.5, 60), note(0.5, 0.5, 64)], { tempo: 120 });
    expect(bytes.length).toBeGreaterThan(20);
    // "MThd"
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x4d, 0x54, 0x68, 0x64]);
  });
});
