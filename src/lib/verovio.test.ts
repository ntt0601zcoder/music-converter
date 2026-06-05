import { describe, it, expect, beforeAll } from 'vitest';
import { quantizeScore, DEFAULT_SCORE_SETTINGS, type ScoreSettings } from './quantize';
import { scoreToMusicXml } from './musicxml';
import type { NoteEventTime } from './transcribe';

// End-to-end check of the notation half: our generated MusicXML must be valid
// enough that Verovio (the real engraver) can parse and render it.

interface Toolkit {
  loadData(data: string): boolean;
  getPageCount(): number;
  renderToSVG(page: number): string;
}

let tk: Toolkit;

beforeAll(async () => {
  const createVerovioModule = (await import('verovio/wasm')).default;
  const { VerovioToolkit } = await import('verovio/esm');
  const mod = await createVerovioModule();
  tk = new VerovioToolkit(mod) as unknown as Toolkit;
}, 120_000);

function note(s: number, d: number, p: number): NoteEventTime {
  return { startTimeSeconds: s, durationSeconds: d, pitchMidi: p, amplitude: 0.8 };
}

const SETTINGS: ScoreSettings = { ...DEFAULT_SCORE_SETTINGS, tempo: 120 };

const CASES: { name: string; notes: NoteEventTime[]; settings: ScoreSettings }[] = [
  {
    name: 'grand staff with chords + barline-crossing notes',
    notes: [
      note(0, 0.5, 60),
      note(0, 0.5, 64),
      note(0, 0.5, 67), // C-E-G chord
      note(0.5, 1.5, 72),
      note(1.5, 1.0, 50), // crosses barline
      note(0, 2.0, 36),
    ],
    settings: SETTINGS,
  },
  {
    name: 'melody single staff in 3/4',
    notes: [note(0, 0.5, 67), note(0.5, 0.25, 69), note(0.75, 0.75, 71), note(2, 1, 72)],
    settings: { ...SETTINGS, mode: 'melody', beats: 3, beatType: 4 },
  },
  {
    name: 'flat key signature',
    notes: [note(0, 0.5, 63), note(0.5, 0.5, 66), note(1, 1, 70)],
    settings: { ...SETTINGS, keyFifths: -3 },
  },
];

describe('Verovio engraves generated MusicXML', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const xml = scoreToMusicXml(quantizeScore(c.notes, c.settings), { title: c.name });
      const ok = tk.loadData(xml);
      // Verovio's cwrap returns 1/0, not a JS boolean.
      expect(ok, 'Verovio.loadData should accept the MusicXML').toBeTruthy();
      expect(tk.getPageCount()).toBeGreaterThanOrEqual(1);
      const svg = tk.renderToSVG(1);
      expect(svg).toContain('<svg');
      expect(svg.length).toBeGreaterThan(500);
    });
  }
});
