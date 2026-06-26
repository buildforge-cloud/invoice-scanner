import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const PROXY_BASE = "/proxy/5173";

/**
 * dev.buildforge.cloud strips the /proxy/<port> prefix before forwarding to
 * Vite, so Vite never sees the base in incoming URLs. This plugin adds it
 * back before Vite's own routing runs, which lets base-prefixed asset paths
 * resolve correctly without a redirect loop.
 */
const proxyPathPlugin: Plugin = {
  name: "proxy-path-rewrite",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && !req.url.startsWith(PROXY_BASE)) {
        req.url = PROXY_BASE + req.url;
      }
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), proxyPathPlugin],

  // Must match the proxy sub-path; remove for direct / production access
  base: PROXY_BASE + "/",

  worker: {
    format: "es",
  },

  server: {
    host: true,
    allowedHosts: ["dev.buildforge.cloud"],
    // HMR WebSocket doesn't route through a path-based proxy — reload manually
    hmr: false,
    headers: {
      // Required for SharedArrayBuffer (ONNX Runtime WASM backend)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },

  optimizeDeps: {
    exclude: ["@huggingface/transformers", "pdfjs-dist"],
  },
});
