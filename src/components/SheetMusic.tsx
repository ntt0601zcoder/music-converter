interface SheetMusicProps {
  pages: string[];
}

/**
 * Render Verovio SVG pages. The SVG markup is trusted output from our own
 * Verovio instance (not user HTML), so dangerouslySetInnerHTML is appropriate.
 */
export function SheetMusic({ pages }: SheetMusicProps) {
  return (
    <div className="sheet" id="sheet-print-area">
      {pages.map((svg, i) => (
        <div
          className="sheet__page"
          key={i}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ))}
    </div>
  );
}
