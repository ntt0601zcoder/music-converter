// Web Worker: runs all note post-processing (outputToNotesPoly) off the main
// thread, so deriving notes and the sensitivity sweep never freeze the UI.
//
// outputToNotesPoly / noteFramesToTime are pure JS (no TensorFlow), so the
// worker stays lightweight — we import them directly from the package's ESM.
import { outputToNotesPoly, noteFramesToTime } from '@spotify/basic-pitch/esm/toMidi';

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

let FRAMES: number[][] = [];
let ONSETS: number[][] = [];

const post = (msg: unknown) =>
  (self as unknown as { postMessage: (m: unknown) => void }).postMessage(msg);

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

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
  notes.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
  return notes;
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
  } catch (err) {
    post({ type: 'error', id, error: err instanceof Error ? err.message : String(err) });
  }
};
