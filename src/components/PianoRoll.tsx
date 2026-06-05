import { useEffect, useMemo, useRef, useState } from 'react';
import { midiToNoteName } from '../lib/music';
import type { NoteEventTime } from '../lib/transcribe';

interface PianoRollProps {
  notes: NoteEventTime[];
  lowMidi: number;
  highMidi: number;
  isPlaying: boolean;
  /** Returns current playback position in seconds (audio clock), or null. */
  getTime: () => number | null;
}

const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
const isWhite = (m: number) => WHITE_PC.includes(((m % 12) + 12) % 12);
const LOOKAHEAD = 3.0; // seconds of upcoming notes visible in the waterfall

/** Synthesia-style falling notes above a virtual piano that lights up in sync. */
export function PianoRoll({ notes, lowMidi, highMidi, isPlaying, getTime }: PianoRollProps) {
  const layout = useMemo(() => {
    const lo = Math.max(21, Math.floor(lowMidi / 12) * 12);
    const hi = Math.min(108, Math.ceil((highMidi + 1) / 12) * 12 - 1);
    const whites: number[] = [];
    const all: number[] = [];
    for (let m = lo; m <= hi; m++) {
      all.push(m);
      if (isWhite(m)) whites.push(m);
    }
    const whiteCount = whites.length || 1;
    const whiteW = 1 / whiteCount;
    const blackW = whiteW * 0.62;
    const whitesBefore = (m: number) => whites.filter((w) => w < m).length;
    /** Returns x and width as fractions (0..1) of the full width. */
    const keyRect = (m: number) => {
      if (isWhite(m)) return { x: whites.indexOf(m) * whiteW, w: whiteW, white: true };
      return { x: whitesBefore(m) * whiteW - blackW / 2, w: blackW, white: false };
    };
    return { lo, hi, whites, all, whiteCount, whiteW, blackW, keyRect };
  }, [lowMidi, highMidi]);

  const rollNotes = useMemo(
    () =>
      notes
        .map((n) => ({
          s: n.startTimeSeconds,
          e: n.startTimeSeconds + Math.max(0.08, n.durationSeconds),
          m: Math.round(n.pitchMidi),
        }))
        .filter((n) => n.m >= layout.lo && n.m <= layout.hi)
        .sort((a, b) => a.s - b.s),
    [notes, layout],
  );

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState<Set<number>>(() => new Set());
  const activeSig = useRef('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let stopped = false;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      if (stopped) return;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      ctx.clearRect(0, 0, W, H);

      const t = isPlaying ? getTime() : null;

      // faint lane separators for white-key boundaries
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (const wm of layout.whites) {
        const x = layout.keyRect(wm).x * W;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }

      if (t != null) {
        const pps = H / LOOKAHEAD;
        const sounding: number[] = [];
        for (const note of rollNotes) {
          if (note.e <= t || note.s > t + LOOKAHEAD) continue;
          const { x, w, white } = layout.keyRect(note.m);
          const px = x * W + 1;
          const pw = Math.max(2, w * W - 2);
          const bottomY = H - (note.s - t) * pps;
          const topY = H - (note.e - t) * pps;
          const y = Math.min(topY, bottomY);
          const hh = Math.max(3, Math.abs(bottomY - topY));
          const hit = note.s <= t && t < note.e;
          if (hit) sounding.push(note.m);

          const grad = ctx.createLinearGradient(0, y, 0, y + hh);
          if (white) {
            grad.addColorStop(0, hit ? '#9db4ff' : '#6d8bff');
            grad.addColorStop(1, hit ? '#6d8bff' : '#4a63cc');
          } else {
            grad.addColorStop(0, hit ? '#c0a4ff' : '#a06bff');
            grad.addColorStop(1, hit ? '#8a6bff' : '#6d4bcc');
          }
          ctx.fillStyle = grad;
          if (ctx.roundRect) {
            ctx.beginPath();
            ctx.roundRect(px, y, pw, hh, 4);
            ctx.fill();
          } else {
            ctx.fillRect(px, y, pw, hh);
          }
          if (hit) {
            ctx.shadowColor = white ? 'rgba(109,139,255,0.9)' : 'rgba(160,107,255,0.9)';
            ctx.shadowBlur = 14;
            ctx.fillRect(px, H - 3, pw, 3);
            ctx.shadowBlur = 0;
          }
        }
        const sig = sounding.sort((a, b) => a - b).join(',');
        if (sig !== activeSig.current) {
          activeSig.current = sig;
          setActive(new Set(sounding));
        }
      } else if (activeSig.current !== '') {
        activeSig.current = '';
        setActive(new Set());
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [isPlaying, getTime, rollNotes, layout]);

  return (
    <div className="pianoroll">
      <canvas ref={canvasRef} className="pianoroll__canvas" />
      <div className="piano__keys">
        {layout.whites.map((m) => {
          const r = layout.keyRect(m);
          const isC = m % 12 === 0;
          return (
            <div
              key={m}
              className={`piano__white${active.has(m) ? ' active' : ''}`}
              style={{ width: `${r.w * 100}%` }}
            >
              {isC && <span className="piano__label">{midiToNoteName(m)}</span>}
            </div>
          );
        })}
        {layout.all
          .filter((m) => !isWhite(m))
          .map((m) => {
            const r = layout.keyRect(m);
            return (
              <div
                key={m}
                className={`piano__black${active.has(m) ? ' active' : ''}`}
                style={{ left: `${r.x * 100}%`, width: `${r.w * 100}%` }}
              />
            );
          })}
      </div>
    </div>
  );
}
