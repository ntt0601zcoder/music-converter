// Minimal ambient typings for the parts of Verovio 6 we use.
// Verovio ships no .d.ts, so we declare the toolkit surface ourselves.

declare module 'verovio/wasm' {
  /** Emscripten module factory; resolves once the WASM runtime is ready. */
  const createVerovioModule: () => Promise<unknown>;
  export default createVerovioModule;
}

declare module 'verovio/esm' {
  export interface VerovioOptions {
    [key: string]: unknown;
  }

  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: VerovioOptions): void;
    getOptions(): VerovioOptions;
    loadData(data: string): boolean;
    getPageCount(): number;
    renderToSVG(pageNo?: number, xmlDeclaration?: boolean): string;
    renderToMIDI(): string;
    getVersion(): string;
    redoLayout(options?: VerovioOptions): void;
  }

  export function enableLog(value: boolean): void;
  export const LOG_OFF: number;
  export const LOG_ERROR: number;
  export const LOG_WARNING: number;
  export const LOG_INFO: number;
  export const LOG_DEBUG: number;
}
