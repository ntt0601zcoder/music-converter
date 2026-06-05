import { useCallback, useRef, useState } from 'react';

interface DropzoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
  currentName?: string | null;
  /** Compact one-line bar (used once a file is loaded). */
  compact?: boolean;
}

export function Dropzone({ onFile, disabled, currentName, compact }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick = useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="audio/*,video/*,.mp3,.wav,.flac,.ogg,.m4a,.mp4,.mov,.webm"
      hidden
      onChange={(e) => handleFiles(e.target.files)}
    />
  );

  if (compact && currentName) {
    return (
      <div
        className={`dropzone-bar${disabled ? ' dropzone--disabled' : ''}`}
        onClick={pick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') pick();
        }}
      >
        {fileInput}
        <span className="dropzone-bar__icon">🎵</span>
        <span className="dropzone-bar__name">{currentName}</span>
        <span className="dropzone-bar__change">Đổi file</span>
      </div>
    );
  }

  return (
    <div
      className={`dropzone${dragOver ? ' dropzone--over' : ''}${disabled ? ' dropzone--disabled' : ''}`}
      onClick={pick}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) handleFiles(e.dataTransfer.files);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') pick();
      }}
    >
      {fileInput}
      <div className="dropzone__icon">🎵 → 🎼</div>
      <div className="dropzone__title">Kéo thả file audio/video vào đây</div>
      <div className="dropzone__hint">
        hoặc bấm để chọn — mp3, wav, flac, ogg, m4a, mp4, mov, webm
      </div>
    </div>
  );
}
