import type { ScoreSettings } from '../lib/quantize';
import type { TranscribeOptions } from '../lib/transcribe';
import type { SensitivitySuggestion } from '../lib/noteWorker';
import { midiToNoteName } from '../lib/music';

interface ControlsProps {
  score: ScoreSettings;
  onScore: (patch: Partial<ScoreSettings>) => void;
  transcribe: TranscribeOptions;
  onTranscribe: (patch: Partial<TranscribeOptions>) => void;
  onRetranscribe: () => void;
  busy: boolean;
  hasAudio: boolean;
  /** Hide the score (notation) section when there are no notes yet. */
  showScore?: boolean;
  /** Auto-calibrate sensitivity from the cached model output. */
  onSuggest: () => void;
  suggesting: boolean;
  suggestProgress: number;
  suggestion: SensitivitySuggestion | null;
  onApplySuggestion: () => void;
  onDismissSuggestion: () => void;
  /** Audio preprocessing — re-runs the model to get genuinely different notes. */
  normalize: boolean;
  onNormalize: (v: boolean) => void;
  gain: number;
  onGain: (v: number) => void;
  onRerunModel: () => void;
}

const TIME_SIGNATURES: { label: string; beats: number; beatType: number }[] = [
  { label: '4/4', beats: 4, beatType: 4 },
  { label: '3/4', beats: 3, beatType: 4 },
  { label: '2/4', beats: 2, beatType: 4 },
  { label: '2/2', beats: 2, beatType: 2 },
  { label: '6/8', beats: 6, beatType: 8 },
  { label: '3/8', beats: 3, beatType: 8 },
];

const KEY_NAMES: Record<number, string> = {
  [-7]: 'Cb trưởng (7♭)', [-6]: 'Gb trưởng (6♭)', [-5]: 'Db trưởng (5♭)',
  [-4]: 'Ab trưởng (4♭)', [-3]: 'Eb trưởng (3♭)', [-2]: 'Bb trưởng (2♭)',
  [-1]: 'F trưởng (1♭)', 0: 'C trưởng (không dấu)', 1: 'G trưởng (1♯)',
  2: 'D trưởng (2♯)', 3: 'A trưởng (3♯)', 4: 'E trưởng (4♯)',
  5: 'B trưởng (5♯)', 6: 'F# trưởng (6♯)', 7: 'C# trưởng (7♯)',
};

const GRID_OPTIONS: { label: string; value: number }[] = [
  { label: 'Nốt đen (1/4)', value: 1 },
  { label: 'Móc đơn (1/8)', value: 2 },
  { label: 'Móc kép (1/16)', value: 4 },
];

export function Controls({
  score,
  onScore,
  transcribe,
  onTranscribe,
  onRetranscribe,
  busy,
  hasAudio,
  showScore = true,
  onSuggest,
  suggesting,
  suggestProgress,
  suggestion,
  onApplySuggestion,
  onDismissSuggestion,
  normalize,
  onNormalize,
  gain,
  onGain,
  onRerunModel,
}: ControlsProps) {
  return (
    <div className="controls">
      {showScore && (
      <details className="controls__section" open>
        <summary>Ký âm</summary>

        <div className="field">
          <label>Bố cục</label>
          <div className="segmented">
            <button
              type="button"
              className={score.mode === 'piano' ? 'active' : ''}
              onClick={() => onScore({ mode: 'piano' })}
            >
              Piano (2 tay)
            </button>
            <button
              type="button"
              className={score.mode === 'melody' ? 'active' : ''}
              onClick={() => onScore({ mode: 'melody' })}
            >
              Giai điệu (1 khuông)
            </button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="tempo">Tempo: {score.tempo} BPM</label>
          <input
            id="tempo"
            type="range"
            min={40}
            max={240}
            step={1}
            value={score.tempo}
            onChange={(e) => onScore({ tempo: Number(e.target.value) })}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="timesig">Số chỉ nhịp</label>
            <select
              id="timesig"
              value={`${score.beats}/${score.beatType}`}
              onChange={(e) => {
                const ts = TIME_SIGNATURES.find((t) => t.label === e.target.value);
                if (ts) onScore({ beats: ts.beats, beatType: ts.beatType });
              }}
            >
              {TIME_SIGNATURES.map((t) => (
                <option key={t.label} value={t.label}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="grid">Lưới làm tròn</label>
            <select
              id="grid"
              value={score.gridDivisionsPerQuarter}
              onChange={(e) => onScore({ gridDivisionsPerQuarter: Number(e.target.value) })}
            >
              {GRID_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="key">Hóa biểu</label>
          <select
            id="key"
            value={score.keyFifths}
            onChange={(e) => onScore({ keyFifths: Number(e.target.value) })}
          >
            {Object.keys(KEY_NAMES)
              .map(Number)
              .sort((a, b) => a - b)
              .map((f) => (
                <option key={f} value={f}>
                  {KEY_NAMES[f]}
                </option>
              ))}
          </select>
        </div>

        {score.mode === 'piano' && (
          <div className="field">
            <label htmlFor="split">
              Ranh giới 2 tay: {midiToNoteName(score.splitMidi)} (MIDI {score.splitMidi})
            </label>
            <input
              id="split"
              type="range"
              min={48}
              max={72}
              step={1}
              value={score.splitMidi}
              onChange={(e) => onScore({ splitMidi: Number(e.target.value) })}
            />
          </div>
        )}
      </details>
      )}

      <details className="controls__section" open>
        <summary>Độ nhạy nhận diện (AI)</summary>

        <div className="field">
          <label htmlFor="onset">
            Ngưỡng nốt mới (onset): {transcribe.onsetThreshold.toFixed(2)}
          </label>
          <input
            id="onset"
            type="range"
            min={0.05}
            max={0.9}
            step={0.05}
            value={transcribe.onsetThreshold}
            onChange={(e) => onTranscribe({ onsetThreshold: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label htmlFor="frame">
            Ngưỡng duy trì nốt (frame): {transcribe.frameThreshold.toFixed(2)}
          </label>
          <input
            id="frame"
            type="range"
            min={0.05}
            max={0.9}
            step={0.05}
            value={transcribe.frameThreshold}
            onChange={(e) => onTranscribe({ frameThreshold: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label htmlFor="minlen">
            Độ dài nốt tối thiểu: {transcribe.minNoteLengthFrames} frame
            {' '}(~{Math.round(transcribe.minNoteLengthFrames * 11.6)} ms)
          </label>
          <input
            id="minlen"
            type="range"
            min={3}
            max={40}
            step={1}
            value={transcribe.minNoteLengthFrames}
            onChange={(e) => onTranscribe({ minNoteLengthFrames: Number(e.target.value) })}
          />
        </div>

        <button
          type="button"
          className="btn btn--suggest"
          disabled={busy || suggesting || !hasAudio}
          onClick={onSuggest}
        >
          {suggesting
            ? `⏳ Đang dò… ${Math.round(suggestProgress * 100)}%`
            : '✨ Tự dò độ nhạy tốt nhất'}
        </button>

        {suggestion && (
          <div className="suggestion">
            <div className="suggestion__title">Gợi ý cho bài này → {suggestion.noteCount} nốt</div>
            <div className="suggestion__rows">
              <span>onset <b>{suggestion.onsetThreshold.toFixed(2)}</b></span>
              <span>frame <b>{suggestion.frameThreshold.toFixed(2)}</b></span>
              <span>min <b>{suggestion.minNoteLengthFrames}</b></span>
            </div>
            <div className="suggestion__actions">
              <button type="button" className="btn btn--primary" onClick={onApplySuggestion}>
                Áp dụng
              </button>
              <button type="button" className="btn" onClick={onDismissSuggestion}>
                Bỏ qua
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || !hasAudio}
          onClick={onRetranscribe}
        >
          ↻ Áp dụng
        </button>
      </details>

      <details className="controls__section">
        <summary>Chạy lại model (AI)</summary>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={normalize}
            onChange={(e) => onNormalize(e.target.checked)}
          />
          Chuẩn hóa âm lượng
        </label>
        <div className="field">
          <label htmlFor="gain">Khuếch đại: {gain.toFixed(1)}×</label>
          <input
            id="gain"
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={gain}
            onChange={(e) => onGain(Number(e.target.value))}
          />
        </div>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={busy || !hasAudio}
          onClick={onRerunModel}
        >
          ↻ Chạy lại model (AI)
        </button>
        <p className="hint">
          Đổi đầu vào audio (to/nhỏ) rồi chạy lại AI → nốt khác. Cùng audio thì AI
          luôn cho nốt y hệt.
        </p>
      </details>
    </div>
  );
}
