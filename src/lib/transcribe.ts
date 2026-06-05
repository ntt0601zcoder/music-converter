// Basic Pitch integration: AudioBuffer (mono 22050 Hz) -> note events.
//
// Basic Pitch bundles its own TensorFlow.js (3.x), so we don't manage tf here.
// The model files live in /public/model and are served at <BASE_URL>model/.

// Basic Pitch (and its bundled TensorFlow.js) is ~1 MB, so we import it
// dynamically on first transcription to keep the initial page load light.
import type { BasicPitch, NoteEventTime } from '@spotify/basic-pitch';

export type { NoteEventTime };

/** Tunable thresholds for note extraction from the model's raw output. */
export interface TranscribeOptions {
  /** Onset confidence threshold (0–1). Higher = fewer, more confident note starts. */
  onsetThreshold: number;
  /** Frame (sustain) confidence threshold (0–1). Higher = shorter/fewer notes. */
  frameThreshold: number;
  /** Minimum note length in model frames (~11.6 ms each). */
  minNoteLengthFrames: number;
  /** Lowest MIDI pitch to keep (null = no limit). */
  minPitchMidi?: number | null;
  /** Highest MIDI pitch to keep (null = no limit). */
  maxPitchMidi?: number | null;
}

export const DEFAULT_TRANSCRIBE_OPTIONS: TranscribeOptions = {
  // Matches the validated Python defaults (basic-pitch predict()).
  onsetThreshold: 0.5,
  frameThreshold: 0.3,
  minNoteLengthFrames: 11, // ~127.7 ms, same as the Python --min-note-ms default

  minPitchMidi: null,
  maxPitchMidi: null,
};

type BasicPitchModule = typeof import('@spotify/basic-pitch');

let modulePromise: Promise<BasicPitchModule> | null = null;
let cachedModel: BasicPitch | null = null;

function loadModule(): Promise<BasicPitchModule> {
  if (!modulePromise) modulePromise = import('@spotify/basic-pitch');
  return modulePromise;
}

function modelUrl(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}model/model.json`;
}

/** Lazily load the Basic Pitch module and construct (and cache) the model. */
export async function getBasicPitch(): Promise<{ model: BasicPitch; mod: BasicPitchModule }> {
  const mod = await loadModule();
  if (!cachedModel) {
    cachedModel = new mod.BasicPitch(modelUrl());
  }
  return { model: cachedModel, mod };
}

/**
 * Raw model output for an audio file. The neural-net inference is the expensive
 * step; once we have this, re-deriving notes at different thresholds is cheap
 * (pure post-processing), so we cache it.
 */
export interface ModelOutput {
  frames: number[][];
  onsets: number[][];
  contours: number[][];
}

/**
 * Run the Basic Pitch neural net once on a mono 22050 Hz AudioBuffer.
 * `onProgress` reports inference progress in 0–1.
 */
export async function runModel(
  audioBuffer: AudioBuffer,
  onProgress?: (fraction: number) => void,
): Promise<ModelOutput> {
  const { model: basicPitch } = await getBasicPitch();
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await basicPitch.evaluateModel(
    audioBuffer,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p) => onProgress?.(p),
  );
  return { frames, onsets, contours };
}

/**
 * Derive note events from cached model output at the given thresholds.
 * This is cheap — changing sensitivity does NOT require re-running the model.
 * Set `withPitchBends` false during calibration sweeps to go even faster.
 */
export async function notesFromOutput(
  output: ModelOutput,
  options: TranscribeOptions,
  withPitchBends = true,
): Promise<NoteEventTime[]> {
  const mod = await loadModule();
  const minFreq = options.minPitchMidi != null ? midiToHz(options.minPitchMidi) : null;
  const maxFreq = options.maxPitchMidi != null ? midiToHz(options.maxPitchMidi) : null;

  const polyNotes = mod.outputToNotesPoly(
    output.frames,
    output.onsets,
    options.onsetThreshold,
    options.frameThreshold,
    options.minNoteLengthFrames,
    true, // inferOnsets
    maxFreq,
    minFreq,
  );

  const notes = withPitchBends
    ? mod.noteFramesToTime(mod.addPitchBendsToNoteEvents(output.contours, polyNotes))
    : mod.noteFramesToTime(polyNotes);

  notes.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
  return notes;
}

/** Convenience: run the model and derive notes in one call. */
export async function transcribeAudioBuffer(
  audioBuffer: AudioBuffer,
  options: TranscribeOptions = DEFAULT_TRANSCRIBE_OPTIONS,
  onProgress?: (fraction: number) => void,
): Promise<NoteEventTime[]> {
  const output = await runModel(audioBuffer, onProgress);
  return notesFromOutput(output, options);
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
