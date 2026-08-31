import * as ort from "onnxruntime-web";

let configured = false;

export function configureOrtEnv(): void {
  if (configured) return;
  configured = true;

  // MV3 extensions cannot use multi-threaded WASM (requires URL.createObjectURL).
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
}

export { ort };
