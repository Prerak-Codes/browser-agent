import * as ort from "onnxruntime-web";

const MODEL_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.25;

const CLASS_NAMES: string[] = [
  "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
  "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat",
  "dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack",
  "umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball",
  "kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket",
  "bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple",
  "sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake",
  "chair","couch","potted plant","bed","dining table","toilet","tv","laptop",
  "mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink",
  "refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush",
];

interface Detection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  classId: number;
  className: string;
}

let session: ort.InferenceSession | null = null;

const _scriptEl = document.currentScript as HTMLScriptElement;
const _imageSrc = _scriptEl?.dataset?.pgImage;
const _modelUrl = _scriptEl?.dataset?.pgModel;
const _wasmDir = _scriptEl?.dataset?.pgWasmDir;

if (_wasmDir) {
  (ort.env.wasm as any).wasmPaths = _wasmDir;
  console.log("[PG-Page] WASM paths set to:", _wasmDir);
}

if (_imageSrc && _modelUrl) {
  detect(_imageSrc, _modelUrl)
    .then((detections) => {
      window.dispatchEvent(new CustomEvent("pg-yolo-result", { detail: detections }));
    })
    .catch((err) => {
      console.error("[PG-Page] YOLO failed:", err);
      window.dispatchEvent(new CustomEvent("pg-yolo-result", { detail: [] }));
    });
} else {
  console.error("[PG-Page] Missing image/model data on script element. currentScript:", _scriptEl);
}

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

async function detect(imageSrc: string, modelUrl: string): Promise<Detection[]> {
  if (!session) {
    console.log("[PG-Page] Loading YOLO from:", modelUrl);
    session = await ort.InferenceSession.create(modelUrl, {
      executionProviders: ["webgpu", "webgl"],
    });
    console.log("[PG-Page] Model loaded!");
  }

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

  const tensor = new ort.Tensor("float32", input, [1, 3, MODEL_SIZE, MODEL_SIZE]);
  const inputName = session.inputNames[0];
  const results = await session.run({ [inputName]: tensor });
  const output = results[session.outputNames[0]];
  if (!output) throw new Error("Model output not found");

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


