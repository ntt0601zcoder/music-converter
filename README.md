# 🎵 → 🎼 Audio/Video → Sheet Music

**🔗 Live app: [music-converter.thuannt.id.vn](https://music-converter.thuannt.id.vn/)**

Turn any **audio or video** into **sheet music**, right in your browser.
Drop in a song, and the app uses AI to detect the notes and engrave a score you can
read, play back, and export — your file never leaves your device.

## What it does

- 🎧 **Import audio or video** (mp3, wav, flac, ogg, m4a, mp4, mov, webm).
- 🤖 **AI note detection** turns the recording into a music score.
- 🎼 **View the sheet music**, and **export** as **MIDI**, **MusicXML**, or **PDF**.
- 🎹 **Play it back** on a piano sound, with a **falling-notes view** — keys light up in time.
- 🎚️ **Fine-tune** the result: tempo, time signature, key, two-hand split, and detection sensitivity
  (with a one-click **auto-calibrate**).

Works best on **solo piano or a clear melody**. Busy, multi-instrument mixes are harder — treat the
output as a strong **draft** and polish it in [MuseScore](https://musescore.org).

## Run it

Needs **Node.js 18+** (20 recommended).

```bash
npm install
npm run dev      # then open the printed http://localhost URL
```

## Use it

1. Drag in (or pick) an audio/video file.
2. Give it a title and click **Transcribe**.
3. Press **Play** to preview, tweak the controls if needed, then **download** MIDI / MusicXML / PDF.

---

Built with [Basic Pitch](https://github.com/spotify/basic-pitch) (Spotify) for note detection and
[Verovio](https://www.verovio.org/) for engraving. Runs 100% in the browser — no server, no sign-up.
