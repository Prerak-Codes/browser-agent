import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync, readdirSync, statSync } from "fs";

function copyManifest() {
  return {
    name: "copy-manifest",
    closeBundle() {
      copyFileSync(
        resolve(__dirname, "manifest.json"),
        resolve(__dirname, "dist/manifest.json")
      );
    },
  };
}

function copyRecursive(src: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = resolve(src, entry);
    const destPath = resolve(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function copyModel() {
  return {
    name: "copy-model",
    closeBundle() {
      copyRecursive(
        resolve(__dirname, "public/model"),
        resolve(__dirname, "dist/model")
      );
      copyRecursive(
        resolve(__dirname, "public/icons"),
        resolve(__dirname, "dist/icons")
      );
    },
  };
}

const ORT_WASM_FILES = [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
];

function copyOrtWasm() {
  return {
    name: "copy-ort-wasm",
    closeBundle() {
      const ortDist = resolve(__dirname, "node_modules/onnxruntime-web/dist");
      const dest = resolve(__dirname, "dist/ort");
      mkdirSync(dest, { recursive: true });
      for (const file of ORT_WASM_FILES) {
        copyFileSync(resolve(ortDist, file), resolve(dest, file));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifest(), copyModel(), copyOrtWasm()],
  resolve: {
    conditions: ["onnxruntime-web-use-extern-wasm", "import", "module", "browser", "default"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        offscreen: resolve(__dirname, "offscreen.html"),
        background: resolve(__dirname, "src/background/serviceWorker.ts"),
        contentScript: resolve(__dirname, "src/content/contentScript.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === "background") return "background.js";
          if (chunkInfo.name === "contentScript") return "contentScript.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
      },
    },
    copyPublicDir: true,
  },
  publicDir: "public",
});
