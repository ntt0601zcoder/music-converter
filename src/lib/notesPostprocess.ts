// Pure note post-processing helpers (testable, no dependencies).

export interface TimedNote {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
}

/**
 * A sustained note is often split by the model into several same-pitch onsets,
 * which read as a stutter of repeats. Merge consecutive same-pitch notes that
 * are separated by no more than `gapSeconds` into one held note.
 */
export function mergeRepeatedNotes<T extends TimedNote>(notes: T[], gapSeconds: number): T[] {
  if (notes.length < 2) return notes.slice();

  const byPitch = new Map<number, T[]>();
  for (const n of notes) {
    const arr = byPitch.get(n.pitchMidi);
    if (arr) arr.push(n);
    else byPitch.set(n.pitchMidi, [n]);
  }

  const out: T[] = [];
  for (const arr of byPitch.values()) {
    arr.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
    let cur = { ...arr[0] };
    for (let i = 1; i < arr.length; i++) {
      const n = arr[i];
      const curEnd = cur.startTimeSeconds + cur.durationSeconds;
      if (n.startTimeSeconds - curEnd <= gapSeconds) {
        const end = Math.max(curEnd, n.startTimeSeconds + n.durationSeconds);
        cur.durationSeconds = end - cur.startTimeSeconds;
        cur.amplitude = Math.max(cur.amplitude, n.amplitude);
      } else {
        out.push(cur);
        cur = { ...n };
      }
    }
    out.push(cur);
  }

  out.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi);
  return out;
}
