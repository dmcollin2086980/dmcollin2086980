// Text-layer extraction for digitally-generated G702/G703 PDFs. This module is
// loaded lazily (dynamic import from PdfImport.tsx) so pdfjs-dist — and its
// worker — ship in their own chunk and stay out of the main bundle, mirroring
// the MemoPreview -> buildPdfMemo lazy-load pattern. No OCR: a scanned PDF with
// no text layer yields zero tokens and the caller surfaces PDF_NO_TEXT_LAYER.

import * as pdfjs from 'pdfjs-dist';
// Vite resolves `?url` to the emitted worker asset URL at build time.
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfToken {
  /** 1-based page number. */
  page: number;
  /** Horizontal position (PDF user units, origin bottom-left). */
  x: number;
  /** Vertical position (PDF user units; larger y = higher on the page). */
  y: number;
  /** Run width in PDF user units. */
  w: number;
  /** The text of this run. */
  str: string;
}

const toArrayBuffer = async (input: File | ArrayBuffer): Promise<ArrayBuffer> =>
  input instanceof ArrayBuffer ? input : await input.arrayBuffer();

export const extractPdfTokens = async (
  input: File | ArrayBuffer,
): Promise<PdfToken[]> => {
  const data = await toArrayBuffer(input);
  const doc = await pdfjs.getDocument({ data }).promise;
  const tokens: PdfToken[] = [];

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      for (const item of content.items) {
        // Marked-content items have no `str`/`transform`; skip them.
        if (!('str' in item) || !('transform' in item)) continue;
        const str = item.str;
        if (str.trim() === '') continue;
        const transform = item.transform as number[];
        tokens.push({
          page: pageNum,
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          w: item.width ?? 0,
          str,
        });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return tokens;
};
