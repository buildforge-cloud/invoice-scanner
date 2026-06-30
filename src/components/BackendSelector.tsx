import { BACKEND_REGISTRY } from "../backends/registry";
import type { ModelStatus } from "../hooks/useInvoiceWorker";

interface Props {
  selectedId: string;
  modelStatus: ModelStatus;
  progress: number;
  onChange: (id: string) => void;
}

export function BackendSelector({ selectedId, modelStatus, progress, onChange }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
        Extraction backend
      </p>
      <div className="space-y-2">
        {Object.values(BACKEND_REGISTRY).map((entry) => {
          const { meta } = entry;
          const isSelected = meta.id === selectedId;
          return (
            <label
              key={meta.id}
              className={[
                "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                isSelected
                  ? "border-brand-400 bg-brand-50"
                  : "border-slate-200 hover:border-slate-300",
              ].join(" ")}
            >
              <input
                type="radio"
                name="backend"
                value={meta.id}
                checked={isSelected}
                onChange={() => onChange(meta.id)}
                className="mt-0.5 accent-brand-600"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800">{meta.name}</span>
                  <span className="text-xs text-slate-400 shrink-0">~{meta.modelSizeMb} MB</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{meta.description}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {meta.stages.join(" → ")}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      {/* Loading bar — shown while the selected backend is initialising */}
      {modelStatus === "loading" && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Loading model…</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
