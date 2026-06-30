interface Props {
  status: "idle" | "loading" | "ready" | "error";
  progress: number; // 0–100
  message: string;
}

export function ModelLoader({ status, message }: Props) {
  if (status !== "error") return null;

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-700">Model load failed</p>
      <p className="text-xs text-red-600 mt-1">{message}</p>
      <p className="mt-1 text-xs text-red-500">
        Check your internet connection for the first-time model download.
      </p>
    </div>
  );
}
