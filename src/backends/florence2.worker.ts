/**
 * Florence-2 OCR backend.
 *
 * Uses Florence-2-base-ft's <OCR> task to extract raw text from the document
 * image, then feeds that text to the same deterministic regex parser used by
 * the Tier 1 text-layer path.  This eliminates numerical hallucination because
 * a language model never touches the numbers — only the OCR step does.
 *
 * Mixed-precision config (from Gemini research):
 *   embed_tokens + vision_encoder → fp16  (preserves visual/coordinate detail)
 *   encoder_model + decoder_model_merged → q4  (saves memory, speeds generation)
 * Total download: ~249 MB
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClass = any;

// Loaded dynamically so Vite doesn't try to pre-bundle the ONNX runtime.
let Florence2ForConditionalGeneration: AnyClass = null;
let AutoProcessor: AnyClass = null;
let RawImage: AnyClass = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processor: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let model: any = null;

const MODEL_ID = "onnx-community/Florence-2-base-ft";

self.addEventListener("message", async (event: MessageEvent) => {
  const { type, imageUrl } = event.data as { type: string; imageUrl?: string };
  if (type === "load") await loadModel();
  else if (type === "infer" && imageUrl) await runInference(imageUrl);
});

function postProgress(progress: number, message: string) {
  self.postMessage({ type: "progress", progress, message });
}

async function loadModel() {
  try {
    // Dynamic import keeps the ONNX runtime out of Vite's pre-bundler.
    const transformers = await import("@huggingface/transformers");
    Florence2ForConditionalGeneration =
      (transformers as unknown as Record<string, AnyClass>)["Florence2ForConditionalGeneration"]
      ?? transformers.AutoModelForVision2Seq;
    AutoProcessor = transformers.AutoProcessor;
    RawImage = transformers.RawImage;

    const device = await detectDevice();

    const procBytes = new Map<string, { loaded: number; total: number }>();
    const modelBytes = new Map<string, { loaded: number; total: number }>();
    let maxPct = 0;

    function byteProgress(map: Map<string, { loaded: number; total: number }>): number {
      let loaded = 0; let total = 0;
      for (const f of map.values()) { loaded += f.loaded; total += f.total; }
      return total > 0 ? loaded / total : 0;
    }

    function reportProgress(
      map: Map<string, { loaded: number; total: number }>,
      rangeStart: number, rangeEnd: number, file: string
    ) {
      const raw = rangeStart + byteProgress(map) * (rangeEnd - rangeStart);
      maxPct = Math.max(maxPct, raw);
      postProgress(maxPct, file ? `Downloading ${file}…` : "Loading…");
    }

    function makeCallback(
      map: Map<string, { loaded: number; total: number }>,
      rangeStart: number, rangeEnd: number
    ) {
      return (info: ProgressInfo) => {
        const key = info.file ?? info.name ?? "file";
        if (info.status === "initiate") {
          map.set(key, { loaded: 0, total: (info as unknown as { total?: number }).total ?? 0 });
        } else if (info.status === "progress") {
          const p = info as unknown as { loaded?: number; total?: number };
          if (p.total) map.set(key, { loaded: p.loaded ?? 0, total: p.total });
        } else if (info.status === "done") {
          const existing = map.get(key);
          if (existing) map.set(key, { loaded: existing.total, total: existing.total });
        }
        reportProgress(map, rangeStart, rangeEnd, info.file ?? "");
      };
    }

    postProgress(0, "Loading processor…");
    processor = await AutoProcessor.from_pretrained(MODEL_ID, {
      progress_callback: makeCallback(procBytes, 0, 10),
    });

    postProgress(10, "Loading Florence-2 weights…");
    model = await Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
      device,
      dtype: {
        embed_tokens: "fp16",
        vision_encoder: "fp16",
        encoder_model: "q4",
        decoder_model_merged: "q4",
      },
      progress_callback: makeCallback(modelBytes, 10, 100),
    });

    self.postMessage({ type: "ready" });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err) });
  }
}

async function runInference(imageUrl: string) {
  if (!processor || !model) {
    self.postMessage({ type: "error", message: "Model not loaded" });
    return;
  }

  try {
    const startMs = Date.now();
    const image = await RawImage.fromURL(imageUrl);

    // Florence-2 uses task tokens, not free-form prompts.
    // <OCR> returns all text on the page as a flat string.
    const task = "<OCR>";
    const inputs = await processor(image, task);

    const outputIds = await model.generate({
      ...inputs,
      max_new_tokens: 1024,
      do_sample: false,
      repetition_penalty: 1.2,
    });

    // post_process_generation decodes the task-specific output format.
    const decoded = processor.batch_decode(outputIds, { skip_special_tokens: false });
    const processed = processor.post_process_generation(
      decoded[0],
      task,
      [image.width, image.height]
    ) as Record<string, string>;

    const ocrText: string = processed[task] ?? decoded[0] ?? "";
    console.log("[florence2 worker] OCR output:", ocrText.slice(0, 500));

    // Feed the OCR text into the same deterministic parser used for text-layer PDFs.
    // Importing here (inside the worker) keeps the parser off the main thread.
    const { parseInvoiceFromText } = await import("../lib/textParser");
    const lines = ocrText.split("\n").map((l) => l.trim()).filter(Boolean);
    const extracted = parseInvoiceFromText(lines, ocrText);

    extracted.rawOutput = ocrText;
    extracted.backendId = "florence2";
    extracted.extractionMs = Date.now() - startMs;

    self.postMessage({ type: "result", payload: extracted });
  } catch (err) {
    self.postMessage({ type: "error", message: String(err) });
  }
}

async function detectDevice(): Promise<"webgpu" | "wasm"> {
  try {
    if ("gpu" in navigator) {
      const adapter = await (
        navigator as { gpu: { requestAdapter(): Promise<unknown> } }
      ).gpu.requestAdapter();
      if (adapter) return "webgpu";
    }
  } catch { /* ignore */ }
  return "wasm";
}

interface ProgressInfo {
  status: string;
  name?: string;
  file?: string;
  loaded?: number;
  total?: number;
}
