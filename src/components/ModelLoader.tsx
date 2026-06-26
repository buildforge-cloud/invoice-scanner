interface Props {
  status: "idle" | "loading" | "ready" | "error";
  progress: number; // 0–100
  message: string;
}

export function ModelLoader({ status, progress, message }: Props) {
  if (status === "idle" || status === "ready") return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">
          {status === "error" ? "Model load failed" : "Loading AI model"}
        </span>
        {status === "loading" && (
          <span className="text-xs text-slate-500">{Math.round(progress)}%</span>
        )}
      </div>

      {status === "loading" && (
        <div className="w-full bg-slate-100 rounded-full h-2 mb-2">
          <div
            className="bg-brand-500 h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <p className="text-xs text-slate-500 truncate">{message}</p>

      {status === "error" && (
        <p className="mt-1 text-xs text-red-600">
          Check your internet connection for the first-time model download.
        </p>
      )}
    </div>
  );
}
