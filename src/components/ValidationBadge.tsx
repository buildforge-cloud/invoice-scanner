import type { ValidationIssue } from "../types/invoice";

interface Props {
  valid: boolean;
  issues: ValidationIssue[];
}

const KIND_LABEL: Record<ValidationIssue["kind"], string> = {
  math_mismatch: "Math error",
  missing_required: "Missing field",
  invalid_format: "Invalid format",
  low_confidence: "Low confidence",
};

const KIND_COLOR: Record<ValidationIssue["kind"], string> = {
  math_mismatch: "text-red-700 bg-red-50 border-red-200",
  missing_required: "text-red-700 bg-red-50 border-red-200",
  invalid_format: "text-amber-700 bg-amber-50 border-amber-200",
  low_confidence: "text-yellow-700 bg-yellow-50 border-yellow-200",
};

export function ValidationBadge({ valid, issues }: Props) {
  return (
    <div className="space-y-2">
      <div
        className={[
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
          valid
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-red-50 text-red-700 border border-red-200",
        ].join(" ")}
      >
        <span>{valid ? "Validation passed" : "Validation failed"}</span>
        <span className="text-xs opacity-75">
          ({issues.filter((i) => i.kind !== "low_confidence").length} errors,{" "}
          {issues.filter((i) => i.kind === "low_confidence").length} warnings)
        </span>
      </div>

      {issues.length > 0 && (
        <ul className="space-y-1">
          {issues.map((issue, idx) => (
            <li
              key={idx}
              className={`rounded-lg border px-3 py-1.5 text-xs ${KIND_COLOR[issue.kind]}`}
            >
              <span className="font-semibold">{KIND_LABEL[issue.kind]}:</span>{" "}
              {issueText(issue)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function issueText(issue: ValidationIssue): string {
  switch (issue.kind) {
    case "math_mismatch":
      return issue.message;
    case "missing_required":
      return `"${issue.field}" is required`;
    case "invalid_format":
      return `${issue.field} — ${issue.message}`;
    case "low_confidence":
      return `"${issue.field}" confidence ${(issue.score * 100).toFixed(0)}% (threshold 85%)`;
  }
}
