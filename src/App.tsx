import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import { Dropzone } from './components/Dropzone';
import { Controls } from './components/Controls';
import { SheetMusic } from './components/SheetMusic';
import { PianoRoll } from './components/PianoRoll';
import { Fretboard } from './components/Fretboard';
import { prepareAudio } from './lib/audio';
import {
  DEFAULT_TRANSCRIBE_OPTIONS,
  runModel,
  type NoteEventTime,
  type TranscribeOptions,
} from './lib/transcribe';
import { deriveNotes, initNoteWorker } from './lib/noteWorker';
import { DEFAULT_SCORE_SETTINGS, quantizeScore, type ScoreSettings } from './lib/quantize';
import { scoreToMusicXml } from './lib/musicxml';
import { notesToMidiBytes } from './lib/midi';
import { preloadVerovio, renderMusicXmlToSvg } from './lib/verovio';
import {
  INSTRUMENTS,
  playNotes,
  type InstrumentId,
  type InstrumentSource,
  type PlaybackHandle,
} from './lib/player';
import { downloadFile, fileStem, formatDuration } from './lib/utils';

type Status = 'idle' | 'fetching' | 'decoding' | 'transcribing' | 'error';
type PlayState = 'idle' | 'loading' | 'playing';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [notes, setNotes] = useState<NoteEventTime[] | null>(null);
  const [durationSeconds, setDurationSeconds] = useState(0);

  const [scoreSettings, setScoreSettings] = useState<ScoreSettings>(DEFAULT_SCORE_SETTINGS);
  const [transcribeOptions, setTranscribeOptions] =
    useState<TranscribeOptions>(DEFAULT_TRANSCRIBE_OPTIONS);

  // Whether the worker holds model output for the current audio (sensitivity
  // changes then re-derive in the worker — no model re-run, no UI freeze).
  const hasOutputRef = useRef(false);

  const [svgPages, setSvgPages] = useState<string[] | null>(null);
  const [rendering, setRendering] = useState(false);

  const [playState, setPlayState] = useState<PlayState>('idle');
  const [playProgress, setPlayProgress] = useState(0);
  const [playSource, setPlaySource] = useState<InstrumentSource | null>(null);
  const [instrument, setInstrument] = useState<InstrumentId>('piano');

  // Resampled mono 22050 Hz buffer kept for re-transcription without re-decoding.
  const preparedBufferRef = useRef<AudioBuffer | null>(null);
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const rafRef = useRef<number | null>(null);

  const busy = status === 'fetching' || status === 'decoding' || status === 'transcribing';

  // --- Derived: quantized score -> MusicXML (cheap; recompute on settings change) ---
  const quantized = useMemo(
    () => (notes && notes.length > 0 ? quantizeScore(notes, scoreSettings) : null),
    [notes, scoreSettings],
  );
  const musicXml = useMemo(
    () => (quantized ? scoreToMusicXml(quantized, { title }) : null),
    [quantized, title],
  );
  const midiBytes = useMemo(
    () =>
      notes && notes.length > 0
        ? notesToMidiBytes(notes, {
            tempo: scoreSettings.tempo,
            instrumentName: scoreSettings.mode === 'piano' ? 'Piano' : 'Instrument',
          })
        : null,
    [notes, scoreSettings.tempo, scoreSettings.mode],
  );

  // Keyboard range derived from the detected notes.
  const pitchRange = useMemo(() => {
    if (!notes || notes.length === 0) return { low: 48, high: 72 };
    let low = 127;
    let high = 0;
    for (const n of notes) {
      const m = Math.round(n.pitchMidi);
      if (m < low) low = m;
      if (m > high) high = m;
    }
    return { low: Math.min(low, high - 11), high: Math.max(high, low + 11) };
  }, [notes]);

  // --- Render SVG whenever the MusicXML changes ---
  useEffect(() => {
    if (!musicXml) {
      setSvgPages(null);
      return;
    }
    let cancelled = false;
    setRendering(true);
    renderMusicXmlToSvg(musicXml)
      .then((pages) => {
        if (!cancelled) setSvgPages(pages);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [musicXml]);

  // --- Piano preview playback ---
  const stopPlayback = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPlayState('idle');
    setPlayProgress(0);
  }, []);

  const getPlaybackTime = useCallback(
    () => playbackRef.current?.currentTime() ?? null,
    [],
  );

  const handlePlayToggle = useCallback(async () => {
    if (playState !== 'idle') {
      stopPlayback();
      return;
    }
    if (!notes || notes.length === 0) return;
    setPlayState('loading');
    try {
      const handle = await playNotes(notes, () => stopPlayback(), instrument);
      playbackRef.current = handle;
      setPlaySource(handle.source);
      setPlayState('playing');
      const tick = () => {
        const elapsed = handle.currentTime(); // AUDIO clock
        const frac = handle.totalSeconds > 0 ? Math.min(1, elapsed / handle.totalSeconds) : 1;
        setPlayProgress(frac);
        if (frac < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setError(
        'Không phát được tiếng piano (cần mạng để tải mẫu âm). ' +
          (err instanceof Error ? err.message : ''),
      );
      stopPlayback();
    }
  }, [playState, notes, stopPlayback, instrument]);

  // Stop any playback when the component unmounts.
  useEffect(() => stopPlayback, [stopPlayback]);

  // Run the model once, hand its output to the worker, then derive notes.
  const runModelAndDerive = useCallback(async (buffer: AudioBuffer, opts: TranscribeOptions) => {
    setStatus('transcribing');
    setProgress(0);
    preloadVerovio();
    const output = await runModel(buffer, (p) => setProgress(p));
    await initNoteWorker(output.frames, output.onsets);
    hasOutputRef.current = true;
    const result = await deriveNotes(opts);
    setNotes(result);
    setStatus('idle');
  }, []);

  // Re-derive at new thresholds — runs in the worker (instant for the UI).
  const reDeriveNotes = useCallback(async (opts: TranscribeOptions) => {
    if (!hasOutputRef.current) return;
    const result = await deriveNotes(opts);
    setNotes(result);
  }, []);

  const handleFile = useCallback((f: File) => {
    setFile(f);
    setTitle(fileStem(f.name));
    setNotes(null);
    setSvgPages(null);
    setError(null);
    setStatus('idle');
    preparedBufferRef.current = null;
    hasOutputRef.current = false;
    preloadVerovio();
  }, []);

  const convertFile = useCallback(
    async (f: File) => {
      setStatus('decoding');
      try {
        const prepared = await prepareAudio(f);
        preparedBufferRef.current = prepared.buffer;
        setDurationSeconds(prepared.durationSeconds);
        await runModelAndDerive(prepared.buffer, transcribeOptions);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    },
    [transcribeOptions, runModelAndDerive],
  );

  const handleConvert = useCallback(async () => {
    if (!file) return;
    stopPlayback();
    setError(null);
    await convertFile(file);
  }, [file, convertFile, stopPlayback]);

  // Load audio from a pasted URL (direct media link or YouTube) via the Worker.
  const loadFromUrl = useCallback(
    async (raw: string) => {
      const link = raw.trim();
      if (!link) return;
      stopPlayback();
      setError(null);
      setStatus('fetching');
      try {
        const isYt = /(?:youtube\.com|youtu\.be)/i.test(link);
        const api = `${isYt ? '/api/youtube' : '/api/fetch'}?url=${encodeURIComponent(link)}`;
        const resp = await fetch(api);
        if (!resp.ok) {
          let msg = `Tải link lỗi ${resp.status}`;
          try {
            const j = (await resp.json()) as { error?: string };
            if (j?.error) msg = j.error;
          } catch {
            /* not json */
          }
          throw new Error(msg);
        }
        const blob = await resp.blob();
        if (blob.size === 0) throw new Error('Link không trả về dữ liệu âm thanh.');

        const titleHdr = resp.headers.get('x-title');
        const rawName = titleHdr
          ? decodeURIComponent(titleHdr)
          : fileStem(link.split('/').pop() || 'link');
        const name = rawName.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'link';
        const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });

        handleFile(file);
        setTitle(name);
        await convertFile(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    },
    [stopPlayback, handleFile, convertFile],
  );

  // "Nhận diện lại" with new sensitivity — now instant (re-derive from cache).
  const handleRetranscribe = useCallback(async () => {
    if (!hasOutputRef.current) return;
    stopPlayback();
    setError(null);
    try {
      await reDeriveNotes(transcribeOptions);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [transcribeOptions, reDeriveNotes, stopPlayback]);

  const stem = file ? fileStem(file.name) : 'transcription';
  const noteCount = notes?.length ?? 0;
  const hasResult = Boolean(notes && notes.length > 0);

  return (
    <div className="app">
      <header className="app__header no-print">
        <h1>🎵 → 🎼 Audio/Video → Sheet nhạc</h1>
      </header>

      <div className="app__top no-print">
        <Dropzone
          onFile={handleFile}
          disabled={busy}
          currentName={file?.name ?? null}
          compact={Boolean(file)}
        />

        <div className="url-row">
          <input
            className="url-input"
            type="url"
            placeholder="hoặc dán link YouTube / audio / video…"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') loadFromUrl(urlInput);
            }}
            disabled={busy}
          />
          <button
            className="btn btn--primary"
            onClick={() => loadFromUrl(urlInput)}
            disabled={busy || !urlInput.trim()}
          >
            Tải từ link
          </button>
        </div>

        {file && (
          <div className="convert-bar">
            <input
              className="title-input"
              type="text"
              value={title}
              placeholder="Tiêu đề bản nhạc"
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
            <button className="btn btn--primary" onClick={handleConvert} disabled={busy}>
              {busy ? 'Đang xử lý…' : notes ? '↻ Chuyển lại' : '🎼 Chuyển thành sheet'}
            </button>
          </div>
        )}

        {busy && (
          <div className="status">
            <div className="status__label">
              {status === 'fetching'
                ? 'Đang tải từ link…'
                : status === 'decoding'
                  ? 'Đang giải mã & resample âm thanh…'
                  : `Đang nhận diện nốt bằng AI… ${Math.round(progress * 100)}%`}
            </div>
            {status === 'transcribing' && (
              <div className="progress">
                <div
                  className="progress__bar"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {error && <div className="error">⚠️ {error}</div>}
      </div>

      {notes !== null && (
        <div className="app__main">
          <aside className="app__sidebar no-print">
            <div className="result-meta">
              <span>🎹 {noteCount} nốt</span>
              {hasResult && <span>⏱ {formatDuration(durationSeconds)}</span>}
              {hasResult && <span>📄 {svgPages?.length ?? 0} trang</span>}
            </div>

            {hasResult && (
            <div className="downloads">
              <button
                className="btn btn--download"
                title="Tải file MIDI (.mid)"
                onClick={() => midiBytes && downloadFile(midiBytes, `${stem}.mid`, 'audio/midi')}
              >
                ⬇ MIDI
              </button>
              <button
                className="btn btn--download"
                title="Tải MusicXML (mở trong MuseScore)"
                onClick={() =>
                  musicXml &&
                  downloadFile(
                    musicXml,
                    `${stem}.musicxml`,
                    'application/vnd.recordare.musicxml+xml',
                  )
                }
              >
                ⬇ XML
              </button>
              <button
                className="btn btn--download"
                title="In hoặc lưu PDF"
                onClick={() => window.print()}
              >
                ⬇ PDF
              </button>
            </div>
            )}

            <Controls
              score={scoreSettings}
              onScore={(patch) => setScoreSettings((s) => ({ ...s, ...patch }))}
              transcribe={transcribeOptions}
              onTranscribe={(patch) => setTranscribeOptions((o) => ({ ...o, ...patch }))}
              onRetranscribe={handleRetranscribe}
              busy={busy}
              hasAudio={Boolean(preparedBufferRef.current)}
              showScore={hasResult}
            />
          </aside>

          <main className="app__sheet">
            {!hasResult ? (
              <div className="empty-result">
                <div className="empty-result__icon">🔍</div>
                <h3>Không phát hiện nốt nào</h3>
                <p>
                  AI không bắt được nốt rõ ràng trong file này. Thử cách sau (ở panel
                  <strong> Độ nhạy nhận diện</strong> bên trái):
                </p>
                <ul>
                  <li>Hạ <strong>onset</strong> xuống ~0.2–0.3 và <strong>frame</strong> ~0.15–0.2</li>
                  <li>Hạ <strong>độ dài nốt tối thiểu</strong> xuống ~5</li>
                  <li>Rồi bấm <strong>↻ Nhận diện lại</strong></li>
                </ul>
                <p className="hint">
                  File video (.mp4) đôi khi giải mã âm thanh không ổn định — thử bấm
                  <strong> ↻ Chuyển lại</strong>, hoặc dùng bản <strong>.mp3/.wav</strong> tách sẵn.
                </p>
              </div>
            ) : (
              <>
            <div className="sheet-header no-print">
              <div className="sheet-toolbar">
                <button
                  className="btn btn--play"
                  onClick={handlePlayToggle}
                  disabled={!hasResult}
                >
                  {playState === 'loading'
                    ? '⏳ Đang tải…'
                    : playState === 'playing'
                      ? '⏹ Dừng'
                      : '▶ Nghe thử'}
                </button>
                <select
                  className="instrument-select"
                  value={instrument}
                  title="Nhạc cụ phát"
                  onChange={(e) => {
                    stopPlayback();
                    setInstrument(e.target.value as InstrumentId);
                  }}
                >
                  {INSTRUMENTS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <div className="play-progress">
                  <div
                    className="play-progress__bar"
                    style={{ width: `${Math.round(playProgress * 100)}%` }}
                  />
                </div>
                {playState !== 'idle' && playSource === 'synth' && (
                  <span className="play-source">(âm tổng hợp tạm — không tải được mẫu)</span>
                )}
              </div>
              {instrument === 'piano' ? (
                <PianoRoll
                  notes={notes ?? []}
                  lowMidi={pitchRange.low}
                  highMidi={pitchRange.high}
                  isPlaying={playState === 'playing'}
                  getTime={getPlaybackTime}
                />
              ) : (
                <Fretboard
                  instrument={instrument}
                  notes={notes ?? []}
                  isPlaying={playState === 'playing'}
                  getTime={getPlaybackTime}
                />
              )}
            </div>
            {rendering && <div className="rendering-overlay no-print">Đang khắc bản nhạc…</div>}
            {svgPages && svgPages.length > 0 ? (
              <SheetMusic pages={svgPages} />
            ) : (
              !rendering && <div className="placeholder no-print">Chưa có bản nhạc.</div>
            )}
              </>
            )}
          </main>
        </div>
      )}

      <footer className="app__footer no-print">
        <p>
          Kết quả tự động là <strong>bản nháp</strong> — chỉnh sửa cuối cùng nên mở file
          MusicXML trong{' '}
          <a href="https://musescore.org" target="_blank" rel="noreferrer">
            MuseScore
          </a>
          .
        </p>
      </footer>
    </div>
  );
}
