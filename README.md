# 🎵 → 🎼 Audio/Video → Sheet Music (Web)

A **React + Vite** web app that turns an **audio or video file** into **sheet music** —
running **entirely in the browser**. No server, no uploads; your file never leaves your machine.

Note recognition is powered by **[Basic Pitch](https://github.com/spotify/basic-pitch)**
(Spotify's open-source AI model, TensorFlow.js build). The app then quantizes the
notes, builds **MusicXML**, and engraves the score with **[Verovio](https://www.verovio.org/)** (WASM).

```
audio/video file (mp3/wav/flac/ogg/m4a/mp4/mov/webm)
   │  Web Audio API            → decode + resample to 22050 Hz mono
   ▼
  PCM mono 22050 Hz
   │  Basic Pitch (AI, TFJS)   → frames/onsets probability maps (run once, cached)
   ▼
  Note events  ──────────────► MIDI (.mid)   (raw timing, faithful)
   │  Quantizer                → snap rhythm, split hands, ties across barlines
   ▼
  MusicXML  ─────────────────► .musicxml     (open/edit in MuseScore)
   │  Verovio (WASM)           → engrave
   ▼
  Sheet music (SVG)  ────────► Print / Save as PDF
```

## ✨ Features

- **Import audio or video** — Web Audio decodes the audio track (Chromium reads mp4/mov/webm too).
- **AI transcription** in the browser (no backend), with downloadable **MIDI**, **MusicXML**, and **Print/PDF**.
- **Piano preview playback** with a real soundfont (bundled locally), plus a **Synthesia-style
  falling-notes piano roll** whose keys light up in sync with the audio.
- **Auto-calibrate sensitivity** — sweeps detection thresholds and suggests the cleanest setting.
- **Instant tweaks** — the AI runs once; changing sensitivity re-derives notes in a **Web Worker**
  (no model re-run, no UI freeze).
- **Re-run the model** on preprocessed audio (normalize / gain) to genuinely change the result.
- **Notation controls** — tempo, time signature, key signature, grand-staff vs single-staff, hand split.

## 1. Requirements

- **Node.js ≥ 18** (20 LTS recommended). If your default is older:
  ```bash
  nvm use 20      # or: nvm install 20 && nvm use 20
  ```
- A **Chromium-based browser** (Chrome/Edge) is recommended — its `decodeAudioData` reliably reads
  the audio track from **video** files (mp4/mov/webm). Firefox/Safari work great for **audio** files.

## 2. Install & run

```bash
npm install
npm run dev          # open http://localhost:5173 (or your configured port)
```

Production build:

```bash
npm run build        # outputs to dist/
npm run preview      # preview the build
```

> On the first **Transcribe**, the browser loads the AI model (~1 MB) and Verovio (~2.4 MB gzip),
> so it takes a moment; subsequent runs use the cache.

## 3. How to use

1. Drag & drop (or click to pick) an **audio/video** file.
2. Set a **title**, then click **🎼 Transcribe**.
3. Click **▶ Play (piano)** to preview — notes fall onto the keyboard and the keys light up in time.
4. Download:
   - **MIDI (.mid)** — raw AI timing, good for a DAW.
   - **MusicXML** — open/edit in [MuseScore](https://musescore.org) (free).
   - **PDF / Print** — the browser print dialog → *Save as PDF* (vector quality).

### Notation controls (instant — no AI re-run)

| Control | Effect |
|---|---|
| **Layout** | Piano grand staff (split hands) or single melody staff. |
| **Tempo (BPM)** | Drives how durations map to note values. |
| **Time signature** | 4/4, 3/4, 2/4, 2/2, 6/8, 3/8. |
| **Quantize grid** | Rounding resolution: quarter / eighth / 16th. |
| **Key signature** | Sharps/flats; also drives accidental spelling. |
| **Hand split** | MIDI pitch dividing the right/left hand (default C4 = 60). |

### Detection sensitivity (instant — re-derives from the cached model output)

| Control | Effect |
|---|---|
| **Onset threshold** | Confidence to count a **new note onset**. Higher = fewer/cleaner; lower = more (riskier). |
| **Frame threshold** | Confidence a note is **still sounding** → controls note **length**. |
| **Min note length** | Drops fragments shorter than this (filters junk). |
| **✨ Auto-calibrate** | Sweeps the above and proposes the cleanest setting (review → Apply). |

> Sensitivity is **post-processing**. The AI sees only the audio, so changing thresholds and
> re-running the model gives the *same* notes — the instant re-derive is exact, just faster.

### Re-run the model (AI)

To get a genuinely **different** result you must change the model's **input**:

- **Normalize** / **Gain** boost the waveform (Basic Pitch doesn't normalize internally, so quiet
  recordings under-detect). Then **↻ Re-run model (AI)**.
- Or feed a cleaner source (a separated **.mp3/.wav** instead of a flaky video decode).

## 4. Tips for better results

1. **Cleaner, simpler audio is best** — solo piano or a clear melodic line. Dense multi-instrument
   mixes are much harder.
2. **Set the right tempo** before reading the score.
3. **Finish in MuseScore** — open the `.musicxml`. Some manual cleanup is needed with *any* automatic tool.

## 5. Limitations (honest)

- Not on par with commercial products (AnthemScore, Klang.io…) trained for years on proprietary data.
  This builds on an open-source model.
- Good for **piano / clear melody**; weaker on **dense mixes, many instruments, or noisy recordings**.
- Hand split is by **pitch threshold** only, not musical context.
- Tempo, key and bar-fitting are **estimates** → treat the output as a **solid draft**.
- The quantizer uses a **power-of-two grid (down to 1/16)** and **does not support triplets** yet.

## 6. Testing

```bash
npm test        # unit tests: quantizer (full bars, ties), MusicXML, MIDI,
                # plus validating the generated MusicXML by loading it into Verovio
```

End-to-end smoke test (needs the dev server running + Google Chrome):

```bash
npm run dev
npm run e2e     # synthesizes a chord-arpeggio WAV, drives the real app in headless
                # Chrome, and verifies note detection + Verovio rendering
```

## 7. Project structure

```
src/
  lib/
    audio.ts        # decode + resample to 22050 Hz mono; audio preprocessing (normalize/gain)
    transcribe.ts   # Basic Pitch model run (TFJS) → frames/onsets (cached)
    note.worker.ts  # Web Worker: outputToNotesPoly post-processing + sensitivity sweep
    noteWorker.ts   # main-thread client for the worker (derive / calibrate)
    midi.ts         # note events → MIDI bytes (@tonejs/midi)
    music.ts        # MIDI → note names / key signatures
    quantize.ts     # quantize → measure/voice model (hand split, ties)
    musicxml.ts     # model → MusicXML 4.0
    player.ts       # piano playback (soundfont + synth fallback, audio-clock sync)
    verovio.ts      # MusicXML → SVG (Verovio WASM, dynamic import)
    *.test.ts       # unit + Verovio integration tests
  components/        # Dropzone, Controls, SheetMusic, PianoRoll (falling notes + keyboard)
  App.tsx           # pipeline orchestration
public/
  model/            # Basic Pitch model weights (served locally)
  soundfonts/       # acoustic grand piano samples (served locally)
```

## 8. Deployment

100% static — no env vars, no backend, no special headers (no SharedArrayBuffer).

- **Root domain** (Netlify / Vercel / Cloudflare Pages): `npm run build`, deploy `dist/`.
- **Subpath** (e.g. GitHub Pages at `…/music-converter/`): build with a base path —
  ```bash
  npm run build -- --base=/music-converter/
  ```
  The model and soundfont paths use `import.meta.env.BASE_URL`, so they follow the base automatically.

## 9. Open-source components

| Purpose | Library | License |
|---|---|---|
| Audio → notes (AI) | [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (Spotify) | Apache-2.0 |
| Model runtime | TensorFlow.js | Apache-2.0 |
| MIDI | [@tonejs/midi](https://github.com/Tonejs/Midi) | MIT |
| Piano samples | [soundfont-player](https://github.com/danigb/soundfont-player) + Gleitz MIDI.js soundfonts | MIT |
| Engraving | [Verovio](https://github.com/rism-digital/verovio) | LGPL-3.0 |
