// Note events -> Standard MIDI File bytes (@tonejs/midi).
// MIDI keeps the raw, un-quantized timing from Basic Pitch — most faithful for
// importing into a DAW. (Quantization is applied only for readable sheet music.)

import { Midi } from '@tonejs/midi';
import type { NoteEventTime } from './transcribe';

export function notesToMidiBytes(
  notes: NoteEventTime[],
  opts: { tempo?: number; instrumentName?: string } = {},
): Uint8Array {
  const midi = new Midi();
  if (opts.tempo && opts.tempo > 0) {
    midi.header.setTempo(opts.tempo);
  }
  const track = midi.addTrack();
  if (opts.instrumentName) track.name = opts.instrumentName;

  for (const n of notes) {
    track.addNote({
      midi: Math.round(n.pitchMidi),
      time: Math.max(0, n.startTimeSeconds),
      duration: Math.max(0.01, n.durationSeconds),
      velocity: clamp01(n.amplitude),
    });
  }
  return midi.toArray();
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0.7;
  return Math.min(1, Math.max(0, x));
}
