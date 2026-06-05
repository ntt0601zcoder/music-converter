// Quantize raw note events into a measure/voice model suitable for notation.
//
// Pipeline: NoteEventTime[] (seconds) -> grid units -> per-staff chord/rest
// timeline -> split at barlines -> decompose each span into tied note values.
// The result (MeasureElement[][] per staff) is rendered to MusicXML elsewhere.

import type { NoteEventTime } from './transcribe';
import { MIDDLE_C } from './music';

export type ScoreMode = 'piano' | 'melody';

export interface ScoreSettings {
  /** Tempo in BPM (quarter-note beat). Drives seconds -> note-value mapping. */
  tempo: number;
  /** Time signature numerator. */
  beats: number;
  /** Time signature denominator (2, 4, 8 ...). */
  beatType: number;
  /** Key signature in fifths: -7..+7 (negative = flats). */
  keyFifths: number;
  /** Grid resolution in divisions per quarter note (1=quarter, 2=eighth, 4=16th). */
  gridDivisionsPerQuarter: number;
  /** Grand staff (piano) vs single treble/bass staff (melody). */
  mode: ScoreMode;
  /** Split point between staves for piano mode (default middle C). */
  splitMidi: number;
  title?: string;
}

export const DEFAULT_SCORE_SETTINGS: ScoreSettings = {
  tempo: 120,
  beats: 4,
  beatType: 4,
  keyFifths: 0,
  gridDivisionsPerQuarter: 4,
  mode: 'piano',
  splitMidi: MIDDLE_C,
};

/** A single notated element: a rest, a single note, or a chord. */
export interface MeasureElement {
  isRest: boolean;
  /** MIDI pitches; multiple = chord. Empty for rests. */
  midis: number[];
  /** Duration in divisions (grid units). */
  durationUnits: number;
  /** MusicXML note type, e.g. 'quarter', 'eighth', '16th'. */
  type: string;
  /** Number of augmentation dots (0 or 1). */
  dots: number;
  /** This element ties INTO the next element (same original note continues). */
  tieStart: boolean;
  /** This element is tied FROM the previous element. */
  tieStop: boolean;
}

export interface StaffNotation {
  clef: 'treble' | 'bass';
  /** Elements grouped per measure. */
  measures: MeasureElement[][];
}

export interface QuantizedScore {
  settings: ScoreSettings;
  /** MusicXML <divisions> per quarter note. */
  divisions: number;
  divisionsPerMeasure: number;
  numberOfMeasures: number;
  /** One staff (melody) or two (piano grand staff, treble then bass). */
  staves: StaffNotation[];
}

interface RawSpan {
  start: number; // global grid units
  dur: number; // grid units (>=1)
  isRest: boolean;
  midis: number[];
}

interface NoteValueToken {
  units: number;
  type: string;
  dots: number;
}

const BASE_NOTE_TYPES: ReadonlyArray<{ type: string; quarters: number }> = [
  { type: 'whole', quarters: 4 },
  { type: 'half', quarters: 2 },
  { type: 'quarter', quarters: 1 },
  { type: 'eighth', quarters: 0.5 },
  { type: '16th', quarters: 0.25 },
  { type: '32nd', quarters: 0.125 },
];

/** Build the table of representable note values (plain + dotted) for a grid. */
function noteValueTable(divisionsPerQuarter: number): NoteValueToken[] {
  const out: NoteValueToken[] = [];
  for (const b of BASE_NOTE_TYPES) {
    const plain = b.quarters * divisionsPerQuarter;
    if (Number.isInteger(plain) && plain >= 1) {
      out.push({ units: plain, type: b.type, dots: 0 });
    }
    const dotted = b.quarters * 1.5 * divisionsPerQuarter;
    if (Number.isInteger(dotted) && dotted >= 1) {
      out.push({ units: dotted, type: b.type, dots: 1 });
    }
  }
  out.sort((a, b) => b.units - a.units);
  return out;
}

/** Greedily decompose a within-measure span into tied note-value tokens. */
function decompose(units: number, table: NoteValueToken[]): NoteValueToken[] {
  const tokens: NoteValueToken[] = [];
  let remaining = units;
  // `table` always contains a 1-unit value (the grid note), so this terminates.
  let guard = 0;
  while (remaining > 0 && guard++ < 1000) {
    const pick = table.find((t) => t.units <= remaining);
    if (!pick) break;
    tokens.push(pick);
    remaining -= pick.units;
  }
  return tokens;
}

function secondsToUnits(seconds: number, secondsPerGrid: number): number {
  return Math.round(seconds / secondsPerGrid);
}

/** Group same-onset notes on a staff into chords and fill gaps with rests. */
function buildSpans(
  staffNotes: { start: number; dur: number; midi: number }[],
  totalUnits: number,
): RawSpan[] {
  if (staffNotes.length === 0) {
    return totalUnits > 0 ? [{ start: 0, dur: totalUnits, isRest: true, midis: [] }] : [];
  }
  // Group by onset.
  const byOnset = new Map<number, { dur: number; midis: Set<number> }>();
  for (const n of staffNotes) {
    const g = byOnset.get(n.start) ?? { dur: 0, midis: new Set<number>() };
    g.dur = Math.max(g.dur, n.dur);
    g.midis.add(n.midi);
    byOnset.set(n.start, g);
  }
  const onsets = [...byOnset.keys()].sort((a, b) => a - b);

  const spans: RawSpan[] = [];
  let pos = 0;
  for (let i = 0; i < onsets.length; i++) {
    const start = onsets[i];
    const group = byOnset.get(start)!;
    if (start > pos) {
      spans.push({ start: pos, dur: start - pos, isRest: true, midis: [] });
    }
    const nextOnset = i + 1 < onsets.length ? onsets[i + 1] : totalUnits;
    const maxDur = Math.max(1, nextOnset - start);
    const dur = Math.min(Math.max(1, group.dur), maxDur);
    spans.push({
      start,
      dur,
      isRest: false,
      midis: [...group.midis].sort((a, b) => a - b),
    });
    pos = start + dur;
  }
  if (pos < totalUnits) {
    spans.push({ start: pos, dur: totalUnits - pos, isRest: true, midis: [] });
  }
  return spans;
}

/** Split spans at barlines and decompose into tied note values per measure. */
function spansToMeasures(
  spans: RawSpan[],
  divisionsPerMeasure: number,
  numberOfMeasures: number,
  table: NoteValueToken[],
): MeasureElement[][] {
  const measures: MeasureElement[][] = Array.from({ length: numberOfMeasures }, () => []);

  for (const span of spans) {
    let cursor = span.start;
    let remaining = span.dur;
    while (remaining > 0) {
      const measureIndex = Math.floor(cursor / divisionsPerMeasure);
      if (measureIndex >= numberOfMeasures) break;
      const measureEnd = (measureIndex + 1) * divisionsPerMeasure;
      const seg = Math.min(remaining, measureEnd - cursor);
      const isFirstSeg = cursor === span.start;
      const isLastSeg = remaining - seg === 0;
      const tokens = decompose(seg, table);
      for (let t = 0; t < tokens.length; t++) {
        const tok = tokens[t];
        const firstToken = isFirstSeg && t === 0;
        const lastToken = isLastSeg && t === tokens.length - 1;
        measures[measureIndex].push({
          isRest: span.isRest,
          midis: span.midis,
          durationUnits: tok.units,
          type: tok.type,
          dots: tok.dots,
          tieStop: !span.isRest && !firstToken,
          tieStart: !span.isRest && !lastToken,
        });
      }
      cursor += seg;
      remaining -= seg;
    }
  }

  // Guarantee every measure has at least a full-measure rest (empty bars).
  for (let m = 0; m < numberOfMeasures; m++) {
    if (measures[m].length === 0) {
      for (const tok of decompose(divisionsPerMeasure, table)) {
        measures[m].push({
          isRest: true,
          midis: [],
          durationUnits: tok.units,
          type: tok.type,
          dots: tok.dots,
          tieStart: false,
          tieStop: false,
        });
      }
    }
  }
  return measures;
}

/** Quantize note events into a full score model. */
export function quantizeScore(
  notes: NoteEventTime[],
  settings: ScoreSettings,
): QuantizedScore {
  const divisions = Math.max(1, Math.round(settings.gridDivisionsPerQuarter));
  const secondsPerQuarter = 60 / Math.max(1, settings.tempo);
  const secondsPerGrid = secondsPerQuarter / divisions;

  const divisionsPerMeasure = Math.max(
    1,
    Math.round(settings.beats * (4 / settings.beatType) * divisions),
  );

  // Quantize to integer grid units.
  const quantized = notes
    .map((n) => ({
      start: Math.max(0, secondsToUnits(n.startTimeSeconds, secondsPerGrid)),
      dur: Math.max(1, secondsToUnits(n.durationSeconds, secondsPerGrid)),
      midi: Math.round(n.pitchMidi),
    }))
    .filter((n) => n.midi >= 0 && n.midi <= 127);

  const maxEnd = quantized.reduce((mx, n) => Math.max(mx, n.start + n.dur), 0);
  const numberOfMeasures = Math.max(1, Math.ceil(maxEnd / divisionsPerMeasure));
  const totalUnits = numberOfMeasures * divisionsPerMeasure;
  const table = noteValueTable(divisions);

  let staves: StaffNotation[];
  if (settings.mode === 'melody') {
    const median = medianMidi(quantized.map((n) => n.midi));
    const clef: 'treble' | 'bass' = median != null && median < 56 ? 'bass' : 'treble';
    staves = [
      {
        clef,
        measures: spansToMeasures(
          buildSpans(quantized, totalUnits),
          divisionsPerMeasure,
          numberOfMeasures,
          table,
        ),
      },
    ];
  } else {
    const treble = quantized.filter((n) => n.midi >= settings.splitMidi);
    const bass = quantized.filter((n) => n.midi < settings.splitMidi);
    staves = [
      {
        clef: 'treble',
        measures: spansToMeasures(
          buildSpans(treble, totalUnits),
          divisionsPerMeasure,
          numberOfMeasures,
          table,
        ),
      },
      {
        clef: 'bass',
        measures: spansToMeasures(
          buildSpans(bass, totalUnits),
          divisionsPerMeasure,
          numberOfMeasures,
          table,
        ),
      },
    ];
  }

  return { settings, divisions, divisionsPerMeasure, numberOfMeasures, staves };
}

function medianMidi(midis: number[]): number | null {
  if (midis.length === 0) return null;
  const sorted = [...midis].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
