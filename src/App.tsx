import { useState, useCallback } from "react";
import type { ExtractionResult, ValidationResult } from "./types/invoice";
import { validateInvoice } from "./lib/validator";
import { rasterizePdf, imageFileToDataUrl } from "./lib/pdfRenderer";
import { extractPdfText } from "./lib/pdfTextExtractor";
import { parseInvoiceFromText } from "./lib/textParser";
import { useInvoiceWorker } from "./hooks/useInvoiceWorker";
import { DropZone } from "./components/DropZone";
import { ModelLoader } from "./components/ModelLoader";
import { InvoicePreview } from "./components/InvoicePreview";
import { ResultPanel } from "./components/ResultPanel";

type AppStatus = "idle" | "rendering" | "inferring" | "done" | "error";

export function App() {
  const { modelStatus, progress, statusMessage, infer } = useInvoiceWorker();

  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [appStatus, setAppStatus] = useState<AppStatus>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      // Revoke previous object URLs to avoid memory leaks
      pageUrls.forEach((u) => {
        if (u.startsWith("blob:")) URL.revokeObjectURL(u);
      });
      setPageUrls([]);
      setCurrentPage(0);
      setResult(null);
      setValidation(null);
      setErrorMessage("");
      setAppStatus("rendering");

      try {
        let urls: string[];
        if (file.type === "application/pdf") {
          // Render pages for preview and attempt text extraction in parallel
          const [renderedUrls, textResult] = await Promise.all([
            rasterizePdf(file),
            extractPdfText(file),
          ]);
          urls = renderedUrls;
          setPageUrls(urls);

          if (textResult.hasTextLayer) {
            // Tier 1: deterministic text extraction — instant, no model needed
            const extracted = parseInvoiceFromText(textResult.lines, textResult.fullText);
            const v = validateInvoice(extracted.invoice, extracted.confidence);
            setResult(extracted);
            setValidation(v);
            setAppStatus("done");
            return;
          }
        } else {
          urls = [await imageFileToDataUrl(file)];
          setPageUrls(urls);
        }

        // Tier 2: VLM inference (scanned images or PDFs without a text layer)
        if (modelStatus !== "ready") {
          setAppStatus("idle");
          return;
        }

        await scanPage(urls, 0);
      } catch (err) {
        setAppStatus("error");
        setErrorMessage(String(err));
      }
    },
    [pageUrls, modelStatus, infer]
  );

  const handleScan = useCallback(async () => {
    if (pageUrls.length === 0 || modelStatus !== "ready") return;
    await scanPage(pageUrls, currentPage);
  }, [pageUrls, currentPage, modelStatus]);

  async function scanPage(urls: string[], pageIndex: number) {
    setAppStatus("inferring");
    try {
      const TIMEOUT_MS = 300_000; // 5 minutes
      const extracted = await Promise.race([
        infer(urls[pageIndex]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Inference timed out after 2 minutes")), TIMEOUT_MS)
        ),
      ]);
      const v = validateInvoice(extracted.invoice, extracted.confidence);
      setResult(extracted);
      setValidation(v);
      setAppStatus("done");
    } catch (err) {
      setAppStatus("error");
      setErrorMessage(String(err));
    }
  }

  const handleCorrect = useCallback(
    (path: string, value: string) => {
      if (!result) return;
      const updated = applyNestedUpdate(result.invoice, path, value);
      const updatedResult = { ...result, invoice: updated };
      const updatedConfidence = { ...result.confidence };
      delete updatedConfidence[path]; // remove flag after human correction
      updatedResult.confidence = updatedConfidence;
      setResult(updatedResult);
      setValidation(validateInvoice(updated, updatedConfidence));
    },
    [result]
  );

  const handleExport = useCallback(() => {
    if (!result) return;
    const json = JSON.stringify(result.invoice, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${result.invoice.invoiceNumber || "export"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const isScanning = appStatus === "inferring";
  const canScan =
    pageUrls.length > 0 && modelStatus === "ready" && !isScanning;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Invoice Scanner</h1>
            <p className="text-xs text-slate-500">
              AI-powered · runs entirely in your browser · no data leaves your device
            </p>
          </div>
          <div
            className={[
              "text-xs px-2.5 py-1 rounded-full font-medium",
              modelStatus === "ready"
                ? "bg-green-50 text-green-700"
                : modelStatus === "error"
                  ? "bg-red-50 text-red-700"
                  : "bg-amber-50 text-amber-700",
            ].join(" ")}
          >
            {modelStatus === "ready"
              ? "Model ready"
              : modelStatus === "error"
                ? "Model error"
                : "Loading model…"}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        <ModelLoader
          status={modelStatus}
          progress={progress}
          message={statusMessage}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left column: upload + preview */}
          <div className="space-y-4">
            <DropZone
              onFile={handleFile}
              disabled={appStatus === "rendering" || isScanning}
            />

            {pageUrls.length > 0 && (
              <>
                <InvoicePreview
                  pageUrls={pageUrls}
                  currentPage={currentPage}
                  onPageChange={setCurrentPage}
                />
                <button
                  onClick={handleScan}
                  disabled={!canScan}
                  className={[
                    "w-full py-2.5 rounded-xl text-sm font-medium transition-colors",
                    canScan
                      ? "bg-brand-600 text-white hover:bg-brand-700"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed",
                  ].join(" ")}
                >
                  {isScanning
                    ? "Scanning…"
                    : modelStatus !== "ready"
                      ? "Waiting for model…"
                      : "Scan this page"}
                </button>
              </>
            )}
          </div>

          {/* Right column: result or status */}
          <div>
            {appStatus === "idle" && pageUrls.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center">
                <p className="text-sm text-slate-400">
                  Upload an invoice to get started
                </p>
              </div>
            )}

            {appStatus === "inferring" && (
              <div className="rounded-xl border border-slate-200 bg-white p-12 text-center space-y-3">
                <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-sm text-slate-500">Extracting invoice data…</p>
                <p className="text-xs text-slate-400">This may take 10–30 seconds on first run</p>
              </div>
            )}

            {appStatus === "error" && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p className="font-medium">Extraction failed</p>
                <p className="mt-1 text-xs font-mono break-all">{errorMessage}</p>
              </div>
            )}

            {appStatus === "done" && result && validation && (
              <ResultPanel
                result={result}
                validation={validation}
                onCorrect={handleCorrect}
                onExport={handleExport}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Immutably set a nested dot-notation path on an object */
function applyNestedUpdate<T extends object>(obj: T, path: string, value: string): T {
  const parts = path.split(".");
  const clone = { ...obj } as Record<string, unknown>;
  let cur = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = { ...(cur[parts[i]] as object) };
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return clone as T;
}
