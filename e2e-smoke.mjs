// One-off end-to-end smoke test: synthesize a C-major arpeggio WAV, drive the
// real app in headless Chrome, and confirm Basic Pitch + Verovio produce a sheet.
import { chromium } from 'playwright';
import fs from 'node:fs';

// --- 1. Synthesize a mono 16-bit WAV: C4 E4 G4 C5, 0.6s each, 0.1s gaps ---
const SR = 44100;
const NOTES = [261.63, 329.63, 392.0, 523.25];
const NOTE_DUR = 0.6;
const GAP = 0.1;
const fade = Math.floor(0.01 * SR);

const samplesPerNote = Math.floor(NOTE_DUR * SR);
const samplesPerGap = Math.floor(GAP * SR);
const total = NOTES.length * (samplesPerNote + samplesPerGap);
const pcm = new Int16Array(total);
let idx = 0;
for (const freq of NOTES) {
  for (let i = 0; i < samplesPerNote; i++) {
    let amp = 0.45;
    if (i < fade) amp *= i / fade;
    if (i > samplesPerNote - fade) amp *= (samplesPerNote - i) / fade;
    pcm[idx++] = Math.round(Math.sin((2 * Math.PI * freq * i) / SR) * amp * 32767);
  }
  idx += samplesPerGap; // silence
}

function wavBytes(int16, sampleRate) {
  const dataLen = int16.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < int16.length; i++) buf.writeInt16LE(int16[i], 44 + i * 2);
  return buf;
}

const wavPath = '/tmp/test-arp.wav';
fs.writeFileSync(wavPath, wavBytes(pcm, SR));
console.log(`WAV written: ${wavPath} (${(fs.statSync(wavPath).size / 1024).toFixed(1)} KB)`);

// --- 2. Drive the app ---
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

const t0 = Date.now();
await page.goto('http://localhost:5180', { waitUntil: 'load' });
await page.setInputFiles('input[type=file]', wavPath);
await page.getByRole('button', { name: /Chuyển thành sheet/ }).click();

let result = 'ok';
try {
  await page.waitForSelector('.sheet svg', { timeout: 180000 });
} catch {
  result = 'TIMEOUT waiting for sheet';
}

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
let meta = '(none)';
try {
  meta = (await page.locator('.result-meta').innerText()).replace(/\n/g, ' | ');
} catch {
  /* ignore */
}
const svgCount = await page.locator('.sheet svg').count();

// --- Playback check: click "Nghe thử" and observe the button state ---
let playState = '(not tested)';
if (result === 'ok') {
  try {
    await page.getByRole('button', { name: /Nghe thử/ }).click();
    // Wait up to 12s for the button to enter playing ("Dừng") or loading state.
    await page
      .waitForFunction(
        () => {
          const b = [...document.querySelectorAll('button')].find(
            (x) => /Dừng|Đang tải tiếng piano|Nghe thử/.test(x.textContent || ''),
          );
          return b && /Dừng/.test(b.textContent || '');
        },
        { timeout: 12000 },
      )
      .catch(() => {});
    const playBtn = page.getByRole('button', { name: /Nghe thử|Dừng|Đang tải tiếng piano/ });
    playState = (await playBtn.innerText().catch(() => '(gone)')).trim();
  } catch (e) {
    playState = 'click failed: ' + (e?.message || e);
  }
}

const errorBox = (await page.locator('.error').count())
  ? await page.locator('.error').innerText()
  : null;

await page.screenshot({ path: '/tmp/e2e-sheet.png', fullPage: true }).catch(() => {});

console.log('--- E2E RESULT ---');
console.log('status      :', result);
console.log('elapsed     :', elapsed, 's');
console.log('result-meta :', meta);
console.log('svg pages   :', svgCount);
console.log('play button :', playState);
console.log('error box   :', errorBox);
console.log('console errs:', errors.length);
errors.slice(0, 12).forEach((e) => console.log('   •', e.slice(0, 200)));

await browser.close();
process.exit(result === 'ok' && svgCount > 0 ? 0 : 1);
