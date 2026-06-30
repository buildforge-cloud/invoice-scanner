# Invoice Scanner

An AI-powered invoice and document scanner that runs **entirely in your browser**. No data is uploaded to any server — all processing happens on your device using WebAssembly and WebGPU.

## Why in-browser?

Invoices and credit card statements contain sensitive financial data. Uploading them to a cloud OCR service creates compliance risk (GDPR, HIPAA, professional secrecy obligations) and exposes your data to third parties. This tool processes everything locally — the document never leaves your machine.

## How it works

Two extraction paths run automatically depending on the document:

**Tier 1 — Text extraction (instant)**
For PDFs that have a text layer (most digital invoices), PDF.js extracts the text and a regex pipeline parses it into structured data. No AI model needed, no waiting.

**Tier 2 — Vision AI (scanned documents)**
For scanned PDFs and images, [SmolVLM-500M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct) runs locally via [Transformers.js](https://huggingface.co/docs/transformers.js) using WebGPU (falls back to WASM). Model weights (~300 MB) download once and are cached in the browser for offline use.

Extracted data is validated against a **Peppol BIS Billing 3.0** schema (European standard EN 16931) with math consistency checks. Fields the model is uncertain about are flagged for human review before export.

## Output

Structured JSON following EN 16931 — compatible with accounting software and ERP systems that accept Peppol-format invoices.

```json
{
  "invoiceNumber": "INV-2024-001",
  "issueDate": "2024-06-01",
  "currencyCode": "NOK",
  "seller": { "name": "Supplier AS", "vatId": "NO123456789MVA" },
  "buyer": { "name": "Stefan Gulbrandsen" },
  "lineItems": [...],
  "totals": { "payableAmount": 1250.00 }
}
```

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build
```

Requires a modern browser with WebGPU support (Chrome 113+, Edge 113+) for AI inference. Falls back to WebAssembly on other browsers.

> **Note:** The dev server sets `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers required for `SharedArrayBuffer`. Your production host must set these headers too.

## Tech stack

- [Transformers.js](https://huggingface.co/docs/transformers.js) — in-browser AI inference
- [SmolVLM-500M-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM-500M-Instruct) — vision language model
- [PDF.js](https://mozilla.github.io/pdf.js/) — PDF rendering and text extraction
- [React](https://react.dev/) + [Tailwind CSS](https://tailwindcss.com/)
- [Vite](https://vitejs.dev/) with ES module Web Workers

## Use cases

- **Accountants and bookkeepers** — process client invoices without uploading to third-party services
- **GDPR-compliant expense processing** — B2C invoices contain personal data; local processing avoids the need for data processing agreements
- **Medical and legal professionals** — invoices subject to privilege or confidentiality obligations
- **Personal tax preparation** — keep your financial documents on your own device
