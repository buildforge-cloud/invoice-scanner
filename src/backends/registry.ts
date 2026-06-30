import type { BackendMeta } from "./types";

export interface BackendRegistryEntry {
  meta: BackendMeta;
  createWorker: () => Worker;
}

export const BACKEND_REGISTRY: Record<string, BackendRegistryEntry> = {
  smolvlm: {
    meta: {
      id: "smolvlm",
      name: "SmolVLM-500M",
      description:
        "General vision-language model prompted for JSON output. Simple but prone to hallucination on dense tables and numbers.",
      modelSizeMb: 300,
      stages: ["SmolVLM-500M-Instruct (WebGPU/WASM)"],
    },
    createWorker: () =>
      new Worker(new URL("./smolvlm.worker.ts", import.meta.url), {
        type: "module",
      }),
  },

  florence2: {
    meta: {
      id: "florence2",
      name: "Florence-2 + Parser",
      description:
        "Florence-2 OCR extracts text from scanned documents; the same deterministic regex parser used for text-layer PDFs handles field extraction. No hallucination risk on numbers.",
      modelSizeMb: 249,
      stages: ["Florence-2-base-ft (OCR, WebGPU/WASM)", "Regex field parser"],
    },
    createWorker: () =>
      new Worker(new URL("./florence2.worker.ts", import.meta.url), {
        type: "module",
      }),
  },
};

export type BackendId = keyof typeof BACKEND_REGISTRY;
export const DEFAULT_BACKEND_ID: BackendId = "smolvlm";

export function getBackend(id: string): BackendRegistryEntry {
  return BACKEND_REGISTRY[id] ?? BACKEND_REGISTRY[DEFAULT_BACKEND_ID];
}
