// Decoding & resampling for both audio and video files, fully in-browser.
//
// Basic Pitch requires mono audio sampled at exactly 22050 Hz, otherwise its
// `evaluateModel` throws. We decode whatever the browser can (mp3/wav/ogg/flac,
// and — in Chromium — the audio track of mp4/webm/mov video), then resample to
// 22050 Hz mono via an OfflineAudioContext.

export const TARGET_SAMPLE_RATE = 22050;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio API không được hỗ trợ trên trình duyệt này.');
  return Ctor;
}

function getOfflineAudioContextCtor(): typeof OfflineAudioContext {
  const w = window as unknown as {
    OfflineAudioContext?: typeof OfflineAudioContext;
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const Ctor = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
  if (!Ctor) throw new Error('OfflineAudioContext không được hỗ trợ trên trình duyệt này.');
  return Ctor;
}

/** Read a File/Blob into an ArrayBuffer. */
function readArrayBuffer(file: Blob): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

/**
 * Decode an audio or video file to an AudioBuffer.
 * For video, the browser extracts and decodes the audio track.
 */
export async function decodeFileToAudioBuffer(file: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await readArrayBuffer(file);
  const Ctor = getAudioContextCtor();
  const ctx = new Ctor();
  try {
    // The promise form is standard; fall back to the callback form for old Safari.
    const decoded = await new Promise<AudioBuffer>((resolve, reject) => {
      const ret = ctx.decodeAudioData(
        arrayBuffer.slice(0),
        (buf) => resolve(buf),
        (err) => reject(err ?? new Error('decodeAudioData failed')),
      );
      // Modern browsers also return a promise.
      if (ret && typeof (ret as Promise<AudioBuffer>).then === 'function') {
        (ret as Promise<AudioBuffer>).then(resolve, reject);
      }
    });
    return decoded;
  } catch (err) {
    throw new Error(
      'Không giải mã được file này. Trình duyệt không đọc được track âm thanh ' +
        '(thử Chrome, hoặc dùng file .mp3/.wav). Chi tiết: ' +
        (err instanceof Error ? err.message : String(err)),
    );
  } finally {
    // Free the hardware context.
    void ctx.close?.();
  }
}

/**
 * Resample an AudioBuffer to mono @ 22050 Hz. A BufferSourceNode played inside
 * an OfflineAudioContext whose sampleRate is 22050 resamples automatically, and
 * routing to a 1-channel destination down-mixes to mono.
 */
export async function resampleToMono22050(buffer: AudioBuffer): Promise<AudioBuffer> {
  if (buffer.sampleRate === TARGET_SAMPLE_RATE && buffer.numberOfChannels === 1) {
    return buffer;
  }
  const frameCount = Math.max(1, Math.ceil(buffer.duration * TARGET_SAMPLE_RATE));
  const Offline = getOfflineAudioContextCtor();
  const offline = new Offline(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  return offline.startRendering();
}

export interface PreprocessOptions {
  /** Peak-normalize to ~0.97 before applying gain (safe boost for quiet audio). */
  normalize: boolean;
  /** Extra gain multiplier applied after normalization (1 = unchanged). */
  gain: number;
}

/**
 * Audio preprocessing that genuinely changes the model's INPUT (so re-running
 * the model afterward yields different notes). Basic Pitch does not normalize
 * internally, so amplitude matters: boosting quiet recordings surfaces notes.
 * Returns the same buffer when there is nothing to do.
 */
export function preprocessBuffer(buffer: AudioBuffer, opts: PreprocessOptions): AudioBuffer {
  const factorFromGain = Number.isFinite(opts.gain) ? opts.gain : 1;
  if (!opts.normalize && factorFromGain === 1) return buffer;

  const data = buffer.getChannelData(0);
  let scale = factorFromGain;
  if (opts.normalize) {
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
    if (peak > 0) scale *= 0.97 / peak;
  }
  if (scale === 1) return buffer;

  const Offline =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;
  const ctx = new Offline(1, data.length, TARGET_SAMPLE_RATE);
  const out = ctx.createBuffer(1, data.length, TARGET_SAMPLE_RATE);
  const dst = out.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const v = data[i] * scale;
    dst[i] = v > 1 ? 1 : v < -1 ? -1 : v; // clamp to avoid clipping overflow
  }
  return out;
}

export interface PreparedAudio {
  /** Mono @ 22050 Hz, ready for Basic Pitch. */
  buffer: AudioBuffer;
  /** Original duration in seconds (from the decoded source). */
  durationSeconds: number;
}

/** Full front-end: File -> decoded -> mono 22050 Hz AudioBuffer. */
export async function prepareAudio(file: Blob): Promise<PreparedAudio> {
  const decoded = await decodeFileToAudioBuffer(file);
  const durationSeconds = decoded.duration;
  const buffer = await resampleToMono22050(decoded);
  return { buffer, durationSeconds };
}
