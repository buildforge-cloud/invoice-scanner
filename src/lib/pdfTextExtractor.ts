export interface PdfTextResult {
  lines: string[];
  fullText: string;
  hasTextLayer: boolean;
}

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

export async function extractPdfText(file: File): Promise<PdfTextResult> {
  const lib = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;

  const allLines: string[] = [];
  let totalItems = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (textContent.items as any[])
      .filter((item) => "str" in item && item.str.trim().length > 0)
      .map((item) => ({
        str: item.str as string,
        x: item.transform[4] as number,
        y: item.transform[5] as number,
      }));

    totalItems += items.length;

    // Group by Y position (PDF coords are bottom-up; round to 3pt tolerance)
    const byY = new Map<number, { str: string; x: number }[]>();
    for (const item of items) {
      const key = Math.round(item.y / 3) * 3;
      if (!byY.has(key)) byY.set(key, []);
      byY.get(key)!.push(item);
    }

    // Sort lines top-to-bottom (descending Y), items left-to-right
    for (const key of [...byY.keys()].sort((a, b) => b - a)) {
      const lineText = byY
        .get(key)!
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (lineText) allLines.push(lineText);
    }
  }

  const hasTextLayer = totalItems > 10;
  return { lines: allLines, fullText: allLines.join("\n"), hasTextLayer };
}
