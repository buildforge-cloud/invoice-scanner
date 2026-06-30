import type { ExtractionResult } from "../types/invoice";

export interface BackendMeta {
  id: string;
  name: string;
  description: string;
  modelSizeMb: number;
  /** Human-readable list of model/stage names shown in the debug panel */
  stages: string[];
}

// ── Worker message protocol ───────────────────────────────────────────────────
// Every backend worker speaks this exact protocol over postMessage.

export type WorkerInMessage =
  | { type: "load" }
  | { type: "infer"; imageUrl: string };

export type WorkerOutMessage =
  | { type: "progress"; progress: number; message: string }
  | { type: "ready" }
  | { type: "result"; payload: ExtractionResult }
  | { type: "error"; message: string };
