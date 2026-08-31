import * as ort from "onnxruntime-web";
import type { Detection } from "./types";
import { CLASS_NAMES, CONFIDENCE_THRESHOLD } from "./types";
import { imageToTensor } from "./preprocessing";

let session: ort.InferenceSession | null = null;

function calculateIoU(a: Detection, b: Detection): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersection = intersectionWidth * intersectionHeight;

  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const union = areaA + areaB - intersection;

  return intersection / union;
}

function applyNMS(
  detections: Detection[],
  iouThreshold: number = 0.45
): Detection[] {
  const sorted = [...detections].sort(
    (a, b) => b.confidence - a.confidence
  );

  const selected: Detection[] = [];

  while (sorted.length > 0) {
    const best = sorted.shift();
    if (!best) break;
    selected.push(best);

    for (let i = sorted.length - 1; i >= 0; i--) {
      const current = sorted[i];
      if (current.classId === best.classId) {
        const iou = calculateIoU(best, current);
        if (iou > iouThreshold) {
          sorted.splice(i, 1);
        }
      }
    }
  }

  return selected;
}

function processOutput(output: ort.Tensor): Detection[] {
  const data = output.data as Float32Array;
  const dimensions = output.dims;
  const numClasses = dimensions[1] - 4;
  const numPredictions = dimensions[2];
  const detections: Detection[] = [];

  for (let i = 0; i < numPredictions; i++) {
    let bestScore = 0;
    let bestClass = 0;

    for (let c = 0; c < numClasses; c++) {
      const score = data[(4 + c) * numPredictions + i];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }

    if (bestScore < CONFIDENCE_THRESHOLD) continue;

    const centerX = data[i];
    const centerY = data[numPredictions + i];
    const width = data[2 * numPredictions + i];
    const height = data[3 * numPredictions + i];

    detections.push({
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
      confidence: bestScore,
      classId: bestClass,
      className: CLASS_NAMES[bestClass] ?? `class-${bestClass}`,
    });
  }

  return applyNMS(detections, 0.45);
}

export async function loadModel(): Promise<ort.InferenceSession> {
  if (session) return session;

  console.log("Loading YOLO model...");
  session = await ort.InferenceSession.create("/model/yolov8n.onnx", {
    executionProviders: ["webgpu", "wasm"],
  });
  console.log("Model loaded!");
  return session;
}

export async function detect(
  imageSrc: string
): Promise<Detection[]> {
  const model = await loadModel();
  const input = await imageToTensor(imageSrc);
  const inputName = model.inputNames[0];

  const results = await model.run({ [inputName]: input });
  const output = results[model.outputNames[0]];

  if (!output) {
    throw new Error("Model output not found");
  }

  return processOutput(output as ort.Tensor);
}

export function drawDetectionsOnCanvas(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  detections: Detection[],
  scaleX: number,
  scaleY: number
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.drawImage(image, 0, 0);

  for (const detection of detections) {
    const x = detection.x * scaleX;
    const y = detection.y * scaleY;
    const w = detection.width * scaleX;
    const h = detection.height * scaleY;

    ctx.strokeStyle = "red";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = "red";
    ctx.font = "16px Arial";
    ctx.fillText(
      `${detection.className} ${(detection.confidence * 100).toFixed(1)}%`,
      x,
      Math.max(15, y - 5)
    );
  }
}
