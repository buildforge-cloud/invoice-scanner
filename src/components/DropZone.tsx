import { useCallback, useState } from "react";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export function DropZone({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file || !ACCEPTED.includes(file.type)) return;
      onFile(file);
    },
    [onFile]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      handleFile(e.dataTransfer.files[0]);
    },
    [handleFile]
  );

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={[
        "flex flex-col items-center justify-center gap-3 w-full rounded-2xl border-2 border-dashed p-12 cursor-pointer transition-colors",
        disabled
          ? "opacity-50 pointer-events-none border-slate-300"
          : dragging
            ? "border-brand-500 bg-brand-50"
            : "border-slate-300 hover:border-brand-500 hover:bg-brand-50",
      ].join(" ")}
    >
      <input
        type="file"
        className="sr-only"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        disabled={disabled}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <svg
        className="w-12 h-12 text-slate-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 48 48"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M28 8H12a4 4 0 0 0-4 4v24a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4V20m-8-12 8 8m-8-8v8h8M20 28l4-4 4 4m-4-4v8"
        />
      </svg>
      <div className="text-center">
        <p className="text-sm font-medium text-slate-700">
          Drop an invoice or click to browse
        </p>
        <p className="mt-1 text-xs text-slate-500">PDF, JPEG, PNG, WEBP</p>
      </div>
    </label>
  );
}
