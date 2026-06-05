// Small browser helpers.

/** Trigger a download of bytes/text as a file. */
export function downloadFile(
  data: Uint8Array | string,
  filename: string,
  mime: string,
): void {
  const part: BlobPart =
    typeof data === 'string'
      ? data
      : // Copy into a fresh ArrayBuffer so Blob gets a plain ArrayBuffer view.
        new Uint8Array(data).buffer;
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Strip the extension from a filename, returning a safe stem. */
export function fileStem(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '');
  return base || 'transcription';
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
