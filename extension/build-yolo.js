import { buildSync } from "esbuild";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

buildSync({
  entryPoints: [join(__dirname, "src/page/yolo-page.ts")],
  bundle: true,
  format: "iife",
  outfile: join(__dirname, "dist/assets/yolo-page.js"),
  target: "es2020",
  platform: "browser",
  minify: false,
  sourcemap: false,
});

console.log("yolo-page.js built as self-contained bundle");
