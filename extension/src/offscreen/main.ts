import { configureOrtEnv, ort } from "../vision/ortConfig";
import type { Detection } from "../vision/types";
import { CLASS_NAMES, CONFIDENCE_THRESHOLD, MODEL_SIZE } from "../vision/types";

configureOrtEnv();

let sessionPromise: Promise<ort.InferenceSession> | null = null;

function calculateIoU(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return intersection / union;
}

function applyNMS(detections: Detection[], iouThreshold = 0.45): Detection[] {
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const selected: Detection[] = [];
  while (sorted.length > 0) {
    const best = sorted.shift()!;
    selected.push(best);
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].classId === best.classId && calculateIoU(best, sorted[i]) > iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }
  return selected;
}

function processOutput(output: ort.Tensor): Detection[] {
  const data = output.data as Float32Array;
  const dims = output.dims;
  const numClasses = dims[1] - 4;
  const numPreds = dims[2];
  const detections: Detection[] = [];

  for (let i = 0; i < numPreds; i++) {
    let bestScore = 0;
    let bestClass = 0;
    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numPreds + i];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    if (bestScore < CONFIDENCE_THRESHOLD) continue;

    detections.push({
      x: data[i] - data[2 * numPreds + i] / 2,
      y: data[numPreds + i] - data[3 * numPreds + i] / 2,
      width: data[2 * numPreds + i],
      height: data[3 * numPreds + i],
      confidence: bestScore,
      classId: bestClass,
      className: CLASS_NAMES[bestClass] ?? `class-${bestClass}`,
    });
  }

  return applyNMS(detections, 0.45);
}

async function imageToTensor(imageSrc: string): Promise<ort.Tensor> {
  const image = new Image();
  image.src = imageSrc;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not load image"));
  });

  const canvas = document.createElement("canvas");
  canvas.width = MODEL_SIZE;
  canvas.height = MODEL_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(image, 0, 0, MODEL_SIZE, MODEL_SIZE);

  const imageData = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);
  const pixels = imageData.data;
  const ch = MODEL_SIZE * MODEL_SIZE;
  const input = new Float32Array(3 * ch);
  for (let i = 0; i < ch; i++) {
    input[i] = pixels[i * 4] / 255;
    input[ch + i] = pixels[i * 4 + 1] / 255;
    input[2 * ch + i] = pixels[i * 4 + 2] / 255;
  }
  return new ort.Tensor("float32", input, [1, 3, MODEL_SIZE, MODEL_SIZE]);
}

async function getSession(): Promise<ort.InferenceSession> {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const modelUrl = chrome.runtime.getURL("model/yolov8n.onnx");
    console.log("[Offscreen] Loading YOLO model from:", modelUrl);

    try {
      const response = await fetch(modelUrl);
      console.log("[Offscreen] Model fetch status:", response.status);
      console.log("[Offscreen] Content-Type:", response.headers.get("content-type"));
      const buffer = await response.arrayBuffer();
      console.log("[Offscreen] Model size:", buffer.byteLength, "bytes");

      if (buffer.byteLength < 1000) {
        throw new Error("Model file too small - likely not a valid ONNX file");
      }

      const firstBytes = new Uint8Array(buffer.slice(0, 4));
      const hex = Array.from(firstBytes).map(b => b.toString(16).padStart(2, "0")).join(" ");
      console.log("[Offscreen] First 4 bytes:", hex);

      if (hex.startsWith("50 4b")) {
        throw new Error("Model file is a ZIP/PyTorch checkpoint, not an ONNX protobuf. Need a real .onnx file.");
      }

      const session = await ort.InferenceSession.create(buffer, {
        executionProviders: ["wasm"],
      });
      console.log("[Offscreen] Session created! Inputs:", session.inputNames, "Outputs:", session.outputNames);
      return session;
    } catch (err) {
      sessionPromise = null;
      console.error("[Offscreen] Failed to create session:", err);
      throw err;
    }
  })();

  return sessionPromise;
}

async function loadAndDetect(imageSrc: string): Promise<Detection[]> {
  const session = await getSession();

  console.log("[Offscreen] Running inference...");
  const input = await imageToTensor(imageSrc);
  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: input });
  const output = results[session.outputNames[0]];
  if (!output) throw new Error("Model output not found");

  const detections = processOutput(output as ort.Tensor);
  console.log("[Offscreen] YOLO detections:", detections.length);
  for (const d of detections) {
    console.log(`[Offscreen]   ${d.className}: ${(d.confidence * 100).toFixed(1)}% at (${Math.round(d.x)},${Math.round(d.y)}) ${Math.round(d.width)}x${Math.round(d.height)}`);
  }
  return detections;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "offscreenDetect") {
    loadAndDetect(message.image)
      .then((detections) => {
        sendResponse({ success: true, detections });
      })
      .catch((err) => {
        console.error("[Offscreen] Detection failed:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
  return false;
});
