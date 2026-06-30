import type { ExtractionResult, ValidationResult, Invoice } from "../types/invoice";
import { ValidationBadge } from "./ValidationBadge";
import { FieldEditor } from "./FieldEditor";
import { DebugPanel } from "./DebugPanel";

interface Props {
  result: ExtractionResult;
  validation: ValidationResult;
  onCorrect: (path: string, value: string) => void;
  onExport: () => void;
}

export function ResultPanel({ result, validation, onCorrect, onExport }: Props) {

  return (
    <div className="space-y-4">
      <ValidationBadge valid={validation.valid} issues={validation.issues} />

      <FieldEditor
        flaggedFields={validation.flaggedFields}
        onCorrect={onCorrect}
      />

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-700">Extracted Invoice Data</h2>
          <button
            onClick={onExport}
            className="text-xs px-3 py-1.5 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors"
          >
            Export JSON
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          <Section title="Document Header">
            <Row label="Invoice Number" value={result.invoice.invoiceNumber} />
            <Row label="Issue Date" value={result.invoice.issueDate} />
            <Row label="Due Date" value={result.invoice.dueDate} />
            <Row label="Type Code" value={result.invoice.typeCode} />
            <Row label="Currency" value={result.invoice.currencyCode} />
          </Section>

          <Section title="Seller">
            <PartyRows party={result.invoice.seller} />
          </Section>

          <Section title="Buyer">
            <PartyRows party={result.invoice.buyer} />
          </Section>

          {result.invoice.lineItems.length > 0 && (
            <Section title="Line Items">
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100">
                      <th className="py-1.5 pr-3 text-left font-medium">Item</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Qty</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Unit Price</th>
                      <th className="py-1.5 pr-3 text-right font-medium">VAT %</th>
                      <th className="py-1.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.invoice.lineItems.map((li) => (
                      <tr key={li.id} className="border-b border-slate-50 last:border-0">
                        <td className="py-1.5 pr-3">{li.name}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {li.quantity} {li.unitCode}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(li.unitPrice)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{li.vatRatePercent}%</td>
                        <td className="py-1.5 text-right tabular-nums font-medium">
                          {fmt(li.lineExtensionAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <Section title="Totals">
            <Row label="Net (excl. tax)" value={fmt(result.invoice.totals.taxExclusiveAmount)} />
            <Row
              label="Tax"
              value={fmt(
                result.invoice.totals.taxInclusiveAmount - result.invoice.totals.taxExclusiveAmount
              )}
            />
            <Row label="Payable Amount" value={fmt(result.invoice.totals.payableAmount)} bold />
          </Section>
        </div>
      </div>

      <DebugPanel result={result} />
    </div>
  );
}

function fmt(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  return n.toFixed(2);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
        {title}
      </h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value?: string | number;
  bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-baseline gap-4">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span
        className={`text-xs text-right tabular-nums ${bold ? "font-semibold text-slate-800" : "text-slate-700"}`}
      >
        {value || "—"}
      </span>
    </div>
  );
}

function PartyRows({ party }: { party: Invoice["seller"] }) {
  const address = [party.address?.street, party.address?.city, party.address?.postCode]
    .filter(Boolean)
    .join(", ");
  return (
    <>
      <Row label="Name" value={party.name} />
      <Row label="VAT ID" value={party.vatId} />
      <Row label="Country" value={party.address?.countryCode} />
      {address && <Row label="Address" value={address} />}
    </>
  );
}
