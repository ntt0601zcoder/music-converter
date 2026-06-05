// Render MusicXML to engraved sheet music (SVG) with Verovio (WASM).
// Verovio is ~7 MB, so it's dynamically imported on first use only.

import type { VerovioToolkit } from 'verovio/esm';

let toolkitPromise: Promise<VerovioToolkit> | null = null;

async function getToolkit(): Promise<VerovioToolkit> {
  if (!toolkitPromise) {
    toolkitPromise = (async () => {
      const [{ VerovioToolkit }, wasmModule] = await Promise.all([
        import('verovio/esm'),
        import('verovio/wasm'),
      ]);
      const createVerovioModule = wasmModule.default;
      const VerovioModule = await createVerovioModule();
      return new VerovioToolkit(VerovioModule);
    })();
  }
  return toolkitPromise;
}

/** Warm up Verovio in the background (e.g. while the model runs). */
export function preloadVerovio(): void {
  void getToolkit().catch(() => {
    /* surfaced later on actual render */
  });
}

export interface RenderOptions {
  /** Verovio zoom (Python script used 40). */
  scale?: number;
  /** Page width in tenths of a millimeter (A4 = 2100). */
  pageWidth?: number;
  /** Page height in tenths of a millimeter (A4 = 2970). */
  pageHeight?: number;
  /** Fit page height to content (good for on-screen scrolling). */
  adjustPageHeight?: boolean;
}

const BASE_OPTIONS = {
  footer: 'none',
  header: 'none',
  pageMarginTop: 100,
  pageMarginBottom: 100,
  pageMarginLeft: 100,
  pageMarginRight: 100,
  spacingSystem: 12,
  breaks: 'auto',
};

/** Render MusicXML into an array of SVG strings, one per page. */
export async function renderMusicXmlToSvg(
  musicXml: string,
  opts: RenderOptions = {},
): Promise<string[]> {
  const tk = await getToolkit();
  tk.setOptions({
    ...BASE_OPTIONS,
    scale: opts.scale ?? 40,
    pageWidth: opts.pageWidth ?? 2100,
    pageHeight: opts.pageHeight ?? 2970,
    adjustPageHeight: opts.adjustPageHeight ?? true,
  });
  const ok = tk.loadData(musicXml);
  if (!ok) {
    throw new Error('Verovio không đọc được MusicXML đã tạo.');
  }
  const pageCount = tk.getPageCount();
  const pages: string[] = [];
  for (let i = 1; i <= Math.max(1, pageCount); i++) {
    pages.push(tk.renderToSVG(i));
  }
  return pages;
}
