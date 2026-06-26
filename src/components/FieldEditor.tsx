import { useState, useEffect, useRef } from "react";
import type { FlaggedField } from "../types/invoice";

interface Props {
  flaggedFields: FlaggedField[];
  onCorrect: (path: string, value: string) => void;
}

export function FieldEditor({ flaggedFields, onCorrect }: Props) {
  // Keep a stable list of all fields we've ever seen so confirmed ones stay visible.
  // New unconfirmed fields merge in; confirmed fields stay until the panel unmounts.
  const [rows, setRows] = useState<FlaggedField[]>(flaggedFields);
  const confirmedPaths = useRef<Set<string>>(new Set());

  useEffect(() => {
    setRows((prev) => {
      const confirmed = prev.filter((f) => confirmedPaths.current.has(f.path));
      const incoming = flaggedFields.filter((f) => !confirmedPaths.current.has(f.path));
      return [...incoming, ...confirmed];
    });
  }, [flaggedFields]);

  function handleConfirm(path: string, value: string) {
    confirmedPaths.current.add(path);
    onCorrect(path, value);
  }

  if (rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 space-y-3">
      <p className="text-sm font-medium text-yellow-800">
        These fields need your review — confidence was below 85%
      </p>
      {rows.map((field) => (
        <FieldRow
          key={field.path}
          field={field}
          isConfirmed={confirmedPaths.current.has(field.path)}
          onConfirm={handleConfirm}
        />
      ))}
    </div>
  );
}

function FieldRow({
  field,
  isConfirmed,
  onConfirm,
}: {
  field: FlaggedField;
  isConfirmed: boolean;
  onConfirm: (path: string, value: string) => void;
}) {
  const [value, setValue] = useState(field.extractedValue ?? "");
  const [confirmed, setConfirmed] = useState(isConfirmed);

  function handleConfirm() {
    onConfirm(field.path, value);
    setConfirmed(true);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleConfirm();
    if (e.key === "Escape") { setValue(field.extractedValue ?? ""); setConfirmed(false); }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label htmlFor={`field-${field.path}`} className="text-xs font-semibold text-yellow-900">
          {field.label}
        </label>
        <span className="text-xs text-yellow-700">
          {confirmed ? "confirmed" : `${(field.confidence * 100).toFixed(0)}% confidence`}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          id={`field-${field.path}`}
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setConfirmed(false); }}
          onKeyDown={handleKeyDown}
          disabled={confirmed}
          className={[
            "flex-1 rounded-lg border px-3 py-1.5 text-sm focus:outline-none focus:ring-2",
            confirmed
              ? "border-green-200 bg-green-50 text-green-800 cursor-default"
              : "border-yellow-300 bg-white focus:ring-yellow-400",
          ].join(" ")}
        />
        <button
          onClick={confirmed ? undefined : handleConfirm}
          className={[
            "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            confirmed
              ? "bg-green-100 text-green-700 border border-green-200 cursor-default"
              : "bg-yellow-600 text-white hover:bg-yellow-700",
          ].join(" ")}
        >
          {confirmed ? "✓ Confirmed" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
