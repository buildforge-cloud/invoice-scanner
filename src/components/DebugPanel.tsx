import { useState } from "react";
import type { ExtractionResult } from "../types/invoice";
import { BACKEND_REGISTRY } from "../backends/registry";
import { CONFIDENCE_THRESHOLD } from "../lib/schema";

interface Props {
  result: ExtractionResult;
}

export function DebugPanel({ result }: Props) {
  const [open, setOpen] = useState(false);
  const [rawExpanded, setRawExpanded] = useState(false);

  const backendMeta = result.backendId ? BACKEND_REGISTRY[result.backendId]?.meta : undefined;
  const confidenceEntries = Object.entries(result.confidence).sort((a, b) => a[1] - b[1]);
  const rawPreview = result.rawOutput.slice(0, 600);
  const rawTruncated = result.rawOutput.length > 600;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Debug info
        </span>
        <span className="text-slate-400 text-xs">{open ? "▲ hide" : "▼ show"}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-slate-100">
          {/* Backend + timing */}
          <div className="pt-3 flex flex-wrap gap-3 text-xs">
            <Chip label="Backend" value={backendMeta?.name ?? result.backendId ?? "unknown"} />
            {result.extractionMs !== undefined && (
              <Chip label="Time" value={`${(result.extractionMs / 1000).toFixed(1)} s`} />
            )}
            {backendMeta && (
              <Chip label="Pipeline" value={backendMeta.stages.join(" → ")} />
            )}
          </div>

          {/* Confidence bars */}
          {confidenceEntries.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-600">Field confidence</p>
              {confidenceEntries.map(([path, score]) => (
                <div key={path} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-40 truncate shrink-0">{path}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={[
                        "h-full rounded-full transition-all",
                        score >= CONFIDENCE_THRESHOLD ? "bg-green-400" : "bg-yellow-400",
                      ].join(" ")}
                      style={{ width: `${Math.round(score * 100)}%` }}
                    />
                  </div>
                  <span
                    className={[
                      "text-xs w-8 text-right shrink-0",
                      score >= CONFIDENCE_THRESHOLD ? "text-green-600" : "text-yellow-600",
                    ].join(" ")}
                  >
                    {Math.round(score * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Raw model output */}
          {result.rawOutput && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-600">Raw output</p>
              <pre className="text-xs font-mono bg-slate-50 border border-slate-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words text-slate-600">
                {rawExpanded ? result.rawOutput : rawPreview}
                {rawTruncated && !rawExpanded && "…"}
              </pre>
              {rawTruncated && (
                <button
                  onClick={() => setRawExpanded((v) => !v)}
                  className="text-xs text-brand-600 hover:underline"
                >
                  {rawExpanded ? "Show less" : `Show all (${result.rawOutput.length} chars)`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1">
      <span className="text-slate-400">{label}:</span>
      <span className="text-slate-700 font-medium">{value}</span>
    </span>
  );
}
