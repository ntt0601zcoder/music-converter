// Minimal typings for soundfont-player (ships no .d.ts).

declare module 'soundfont-player' {
  export interface SoundfontInstrument {
    play(
      note: number | string,
      when?: number,
      options?: { duration?: number; gain?: number },
    ): unknown;
    stop(when?: number): void;
    connect(destination: AudioNode): SoundfontInstrument;
  }

  export interface SoundfontOptions {
    soundfont?: 'MusyngKite' | 'FluidR3_GM';
    format?: 'mp3' | 'ogg';
    gain?: number;
    notes?: Array<string | number>;
    destination?: AudioNode;
  }

  const Soundfont: {
    instrument(
      ac: BaseAudioContext,
      name: string,
      options?: SoundfontOptions,
    ): Promise<SoundfontInstrument>;
    nameToUrl(name: string, soundfont?: string, format?: string): string;
  };

  export default Soundfont;
}
