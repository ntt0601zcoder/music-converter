// Web Worker: runs all note post-processing (outputToNotesPoly) off the main
// thread, so deriving notes and the sensitivity sweep never freeze the UI.
//
// outputToNotesPoly / noteFramesToTime are pure JS (no TensorFlow), so the
// worker stays lightweight — we import them directly from the package's ESM.
import { outputToNotesPoly, noteFramesToTime } from '@spotify/basic-pitch/esm/toMidi';
import { mergeRepeatedNotes } from './notesPostprocess';

interface DeriveOptions {
  onsetThreshold: number;
  frameThreshold: number;
  minNoteLengthFrames: number;
  minPitchMidi?: number | null;
  maxPitchMidi?: number | null;
}

interface NoteEventTime {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
}

const ONSET_GRID = [0.2, 0.3, 0.4, 0.5];
const FRAME_GRID = [0.2, 0.35];
const MINLEN_GRID = [7, 11];
const JUNK_SECONDS = 0.06;
const ANNOTATIONS_FPS = Math.floor(22050 / 256); // ~86
const CALIB_WINDOW_FRAMES = 40 * ANNOTATIONS_FPS; // calibrate on a ~40 s excerpt

let FRAMES: number[][] = [];
let ONSETS: number[][] = [];

const post = (msg: unknown) =>
  (self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg);

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Merge same-pitch onsets separated by only a tiny gap (a held note the model
// chopped into repeats) into one note.
const MERGE_GAP_SECONDS = 0.09;

function derive(frames: number[][], onsets: number[][], o: DeriveOptions): NoteEventTime[] {
  const minFreq = o.minPitchMidi != null ? midiToHz(o.minPitchMidi) : null;
  const maxFreq = o.maxPitchMidi != null ? midiToHz(o.maxPitchMidi) : null;
  const poly = outputToNotesPoly(
    frames,
    onsets,
    o.onsetThreshold,
    o.frameThreshold,
    o.minNoteLengthFrames,
    true,
    maxFreq,
    minFreq,
  );
  const notes = noteFramesToTime(poly) as NoteEventTime[];
  return mergeRepeatedNotes(notes, MERGE_GAP_SECONDS);
}

function scoreNotes(notes: NoteEventTime[]): number {
  const n = notes.length;
  if (n === 0) return -Infinity;
  let junk = 0;
  let end = 0;
  for (const x of notes) {
    if (x.durationSeconds < JUNK_SECONDS) junk++;
    end = Math.max(end, x.startTimeSeconds + x.durationSeconds);
  }
  const good = n - junk;
  const notesPerSecond = n / Math.max(1, end);
  let score = good - 3 * junk;
  if (notesPerSecond > 16) score -= notesPerSecond - 16;
  return score;
}

self.onmessage = (e: MessageEvent) => {
  const data = e.data as { type: string; id: number; [k: string]: unknown };
  const { type, id } = data;
  try {
    if (type === 'init') {
      FRAMES = data.frames as number[][];
      ONSETS = data.onsets as number[][];
      post({ type: 'result', id, result: null });
      return;
    }
    if (type === 'derive') {
      const notes = derive(FRAMES, ONSETS, data.options as DeriveOptions);
      post({ type: 'result', id, result: notes });
      return;
    }
    if (type === 'calibrate') {
      // Calibrate on a representative middle excerpt for speed on long songs.
      let f = FRAMES;
      let o = ONSETS;
      if (FRAMES.length > CALIB_WINDOW_FRAMES) {
        const start = Math.floor((FRAMES.length - CALIB_WINDOW_FRAMES) / 2);
        f = FRAMES.slice(start, start + CALIB_WINDOW_FRAMES);
        o = ONSETS.slice(start, start + CALIB_WINDOW_FRAMES);
      }
      const scale = FRAMES.length / Math.max(1, f.length);
      const combos: { on: number; fr: number; ml: number }[] = [];
      for (const on of ONSET_GRID)
        for (const fr of FRAME_GRID) for (const ml of MINLEN_GRID) combos.push({ on, fr, ml });

      let best: {
        onsetThreshold: number;
        frameThreshold: number;
        minNoteLengthFrames: number;
        noteCount: number;
      } | null = null;
      let bestScore = -Infinity;

      for (let i = 0; i < combos.length; i++) {
        const c = combos[i];
        const notes = derive(f, o, {
          onsetThreshold: c.on,
          frameThreshold: c.fr,
          minNoteLengthFrames: c.ml,
        });
        const sc = scoreNotes(notes);
        if (sc > bestScore) {
          bestScore = sc;
          best = {
            onsetThreshold: c.on,
            frameThreshold: c.fr,
            minNoteLengthFrames: c.ml,
            noteCount: Math.round(notes.length * scale),
          };
        }
        post({ type: 'progress', id, value: (i + 1) / combos.length });
      }
      post({
        type: 'result',
        id,
        result: best ?? {
          onsetThreshold: 0.2,
          frameThreshold: 0.2,
          minNoteLengthFrames: 7,
          noteCount: 0,
        },
      });
      return;
    }
  } catch (err) {
    post({ type: 'error', id, error: err instanceof Error ? err.message : String(err) });
  }
};
