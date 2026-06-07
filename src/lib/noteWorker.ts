// Main-thread client for note.worker.ts. The worker holds the model output
// (frames/onsets) and does all heavy note post-processing off the main thread.

import type { NoteEventTime, TranscribeOptions } from './transcribe';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (fraction: number) => void;
}

let worker: Worker | null = null;
const pending = new Map<number, Pending>();
let nextId = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./note.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; id: number; value?: number; result?: unknown; error?: string };
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') {
        p.onProgress?.(m.value ?? 0);
        return;
      }
      pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.error ?? 'worker error'));
      else p.resolve(m.result);
    };
  }
  return worker;
}

function request<T>(
  type: string,
  payload: Record<string, unknown>,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  const w = getWorker();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
    w.postMessage({ type, id, ...payload });
  });
}

/** Send the model output to the worker once; subsequent calls reuse it. */
export function initNoteWorker(frames: number[][], onsets: number[][]): Promise<void> {
  return request('init', { frames, onsets });
}

/** Derive notes at the given thresholds — runs in the worker, no UI freeze. */
export function deriveNotes(options: TranscribeOptions): Promise<NoteEventTime[]> {
  return request('derive', { options });
}
