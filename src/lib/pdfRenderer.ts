import type { RenderParameters } from "pdfjs-dist/types/src/display/api";

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    // Use the bundled worker via CDN to avoid bundling the ~300KB worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjsLib;
}

/**
 * Rasterizes a single page of a PDF file to an ImageData blob URL.
 * Returns one blob URL per page (caller is responsible for revoking).
 */
export async function rasterizePdf(
  file: File,
  scale = 1.8
): Promise<string[]> {
  const lib = await getPdfjs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: arrayBuffer }).promise;

  const pageUrls: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext("2d")!;
    const renderContext: RenderParameters = {
      canvasContext: ctx,
      viewport,
    };

    await page.render(renderContext).promise;
    const url = canvas.toDataURL("image/png");
    pageUrls.push(url);
  }

  return pageUrls;
}

/** Convert an image File (JPEG / PNG / WEBP) to a data URL */
export function imageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
