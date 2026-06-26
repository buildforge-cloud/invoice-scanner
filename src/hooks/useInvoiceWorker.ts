import { useEffect, useRef, useState, useCallback } from "react";
import type { ExtractionResult } from "../types/invoice";

export type ModelStatus = "idle" | "loading" | "ready" | "error";

interface InvoiceWorker {
  modelStatus: ModelStatus;
  progress: number;
  statusMessage: string;
  infer: (imageUrl: string) => Promise<ExtractionResult>;
}

type InferResolve = (r: ExtractionResult) => void;
type InferReject = (e: Error) => void;

export function useInvoiceWorker(): InvoiceWorker {
  const workerRef = useRef<Worker | null>(null);
  const resolveRef = useRef<InferResolve | null>(null);
  const rejectRef = useRef<InferReject | null>(null);

  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/inference.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as {
        type: string;
        progress?: number;
        message?: string;
        payload?: ExtractionResult;
      };

      switch (msg.type) {
        case "progress":
          setModelStatus("loading");
          setProgress(msg.progress ?? 0);
          setStatusMessage(msg.message ?? "");
          break;

        case "ready":
          setModelStatus("ready");
          setProgress(100);
          setStatusMessage("Model ready");
          break;

        case "result":
          if (resolveRef.current && msg.payload) {
            resolveRef.current(msg.payload);
            resolveRef.current = null;
            rejectRef.current = null;
          }
          break;

        case "error":
          if (rejectRef.current) {
            rejectRef.current(new Error(msg.message ?? "Unknown error"));
            resolveRef.current = null;
            rejectRef.current = null;
          } else {
            setModelStatus("error");
            setStatusMessage(msg.message ?? "Model load failed");
          }
          break;
      }
    };

    worker.onerror = (e) => {
      setModelStatus("error");
      setStatusMessage(e.message);
    };

    workerRef.current = worker;

    setModelStatus("loading");
    setStatusMessage("Initializing…");
    worker.postMessage({ type: "load" });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const infer = useCallback((imageUrl: string): Promise<ExtractionResult> => {
    return new Promise<ExtractionResult>((resolve, reject) => {
      if (!workerRef.current) {
        reject(new Error("Worker not available"));
        return;
      }
      resolveRef.current = resolve;
      rejectRef.current = reject;
      workerRef.current.postMessage({ type: "infer", imageUrl });
    });
  }, []);

  return { modelStatus, progress, statusMessage, infer };
}
