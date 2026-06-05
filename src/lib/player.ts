// Preview playback of transcribed notes with a piano sound.
//
// Strategy (robust for slow/blocked networks):
//   1. Load a piano soundfont bundled LOCALLY (public/soundfonts/…). No network.
//   2. If that fails, try Benjamin Gleitzman's hosted soundfont (needs network).
//   3. If both fail, fall back to a simple oscillator synth — so there is ALWAYS
//      audible output.
//
// We play the RAW detected notes (absolute seconds, original timing) so the
// preview reflects what the AI actually heard — independent of quantization.

import Soundfont, { type SoundfontInstrument } from 'soundfont-player';
import type { NoteEventTime } from './transcribe';

export type InstrumentSource = 'soundfont-local' | 'soundfont-cdn' | 'synth';

interface Instrument {
  source: InstrumentSource;
  play(midi: number, when: number, duration: number, gain: number): void;
  stop(): void;
}

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let instrumentPromise: Promise<Instrument> | null = null;

/** Output boost so preview is clearly audible (soundfont samples are quiet). */
const MASTER_GAIN = 3;

function getCtx(): AudioContext {
  if (!audioCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

/** A shared master gain node feeding the speakers. */
function getMaster(): GainNode {
  const ac = getCtx();
  if (!masterGain) {
    masterGain = ac.createGain();
    masterGain.gain.value = MASTER_GAIN;
    masterGain.connect(ac.destination);
  }
  return masterGain;
}

/**
 * Re-bind the (cached) AudioContext to the CURRENT default output device.
 * Without this, a context created while e.g. Bluetooth headphones were active
 * keeps sending audio to that now-disconnected device — silent on the speakers.
 */
async function bindToDefaultOutput(ac: AudioContext): Promise<void> {
  const withSink = ac as unknown as { setSinkId?: (id: string) => Promise<void> };
  if (typeof withSink.setSinkId === 'function') {
    try {
      await withSink.setSinkId('');
    } catch {
      /* not supported / not allowed — ignore */
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      window.setTimeout(() => reject(new Error(`${label} timeout sau ${ms} ms`)), ms),
    ),
  ]);
}

function wrapSoundfont(sf: SoundfontInstrument, source: InstrumentSource): Instrument {
  return {
    source,
    play: (midi, when, duration, gain) => {
      sf.play(midi, when, { duration, gain });
    },
    stop: () => sf.stop(),
  };
}

/** Oscillator fallback — guarantees audible output even with no samples. */
function makeSynth(ac: AudioContext): Instrument {
  const active = new Set<{ osc: OscillatorNode; gain: GainNode }>();
  return {
    source: 'synth',
    play: (midi, when, duration, gain) => {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      const osc = ac.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const g = ac.createGain();
      const peak = Math.min(0.5, Math.max(0.05, gain) * 0.5);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0008, when + duration);
      osc.connect(g);
      g.connect(getMaster());
      osc.start(when);
      osc.stop(when + duration + 0.05);
      const rec = { osc, gain: g };
      active.add(rec);
      osc.onended = () => {
        try {
          g.disconnect();
          osc.disconnect();
        } catch {
          /* already gone */
        }
        active.delete(rec);
      };
    },
    stop: () => {
      const now = ac.currentTime;
      for (const { osc, gain } of active) {
        try {
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(0.0001, now);
          osc.stop(now + 0.02);
        } catch {
          /* ignore */
        }
      }
      active.clear();
    },
  };
}

async function loadSoundfontInstrument(ac: AudioContext): Promise<Instrument> {
  const base = import.meta.env.BASE_URL ?? '/';
  const localUrl = `${base}soundfonts/acoustic_grand_piano-mp3.js`;
  const dest = getMaster();
  // 1. Local bundled soundfont (no network).
  try {
    const sf = await withTimeout(
      Soundfont.instrument(ac, localUrl, { destination: dest }),
      20000,
      'tải tiếng piano (local)',
    );
    return wrapSoundfont(sf, 'soundfont-local');
  } catch (errLocal) {
    console.warn('[player] local soundfont failed, trying CDN:', errLocal);
  }
  // 2. Hosted soundfont (needs network).
  const sf = await withTimeout(
    Soundfont.instrument(ac, 'acoustic_grand_piano', { soundfont: 'FluidR3_GM', destination: dest }),
    20000,
    'tải tiếng piano (CDN)',
  );
  return wrapSoundfont(sf, 'soundfont-cdn');
}

/** Load (and cache) a playable piano. Never rejects: falls back to a synth. */
function loadInstrument(): Promise<Instrument> {
  const ac = getCtx();
  if (!instrumentPromise) {
    instrumentPromise = loadSoundfontInstrument(ac).catch((err) => {
      console.warn('[player] all soundfonts failed, using synth fallback:', err);
      return makeSynth(ac);
    });
  }
  return instrumentPromise;
}

export interface PlaybackHandle {
  /** Length of the scheduled playback in seconds. */
  totalSeconds: number;
  /** Which engine ended up playing. */
  source: InstrumentSource;
  /** Current playback position in seconds, read from the AUDIO clock. */
  currentTime: () => number;
  /** Stop immediately and cancel the end callback. */
  stop: () => void;
}

/**
 * Schedule all notes on the piano. `onEnd` fires once when playback finishes
 * naturally. Returns a handle to stop early.
 */
export async function playNotes(
  notes: NoteEventTime[],
  onEnd: () => void,
): Promise<PlaybackHandle> {
  const ac = getCtx();
  if (ac.state === 'suspended') await ac.resume();
  await bindToDefaultOutput(ac); // follow the CURRENT default output device
  const inst = await loadInstrument();

  const sorted = [...notes].sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  let total = 0;
  for (const n of sorted) {
    total = Math.max(total, n.startTimeSeconds + Math.max(0.08, n.durationSeconds));
  }

  // Lookahead scheduler: schedule only the next ~0.6 s of notes each tick, so
  // we never block the main thread by creating thousands of nodes at once.
  const t0 = ac.currentTime + 0.2;
  const SCHEDULE_AHEAD = 0.6;
  let i = 0;
  const scheduleDue = () => {
    const horizon = ac.currentTime - t0 + SCHEDULE_AHEAD;
    while (i < sorted.length && sorted[i].startTimeSeconds <= horizon) {
      const n = sorted[i++];
      const duration = Math.max(0.08, n.durationSeconds);
      const gain = Math.min(1, Math.max(0.25, Number.isFinite(n.amplitude) ? n.amplitude : 0.7));
      inst.play(Math.round(n.pitchMidi), t0 + Math.max(0, n.startTimeSeconds), duration, gain);
    }
    if (i >= sorted.length) window.clearInterval(schedulerId);
  };
  scheduleDue(); // schedule the first batch immediately
  const schedulerId = window.setInterval(scheduleDue, 50);

  const endTimer = window.setTimeout(onEnd, (total + 0.6) * 1000);

  return {
    totalSeconds: total,
    source: inst.source,
    currentTime: () => Math.max(0, ac.currentTime - t0),
    stop: () => {
      window.clearInterval(schedulerId);
      window.clearTimeout(endTimer);
      try {
        inst.stop();
      } catch {
        /* nothing playing */
      }
    },
  };
}
