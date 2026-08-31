import * as ort from "onnxruntime-web";
import { MODEL_SIZE } from "./types";

export async function imageToTensor(
  imageSrc: string
): Promise<ort.Tensor> {
  const image = new Image();
  image.src = imageSrc;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () =>
      reject(new Error(`Could not load image: ${imageSrc}`));
  });

  const canvas = document.createElement("canvas");
  canvas.width = MODEL_SIZE;
  canvas.height = MODEL_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create canvas context");
  }

  ctx.drawImage(image, 0, 0, MODEL_SIZE, MODEL_SIZE);

  const imageData = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);
  const pixels = imageData.data;
  const channelSize = MODEL_SIZE * MODEL_SIZE;
  const input = new Float32Array(3 * channelSize);

  for (let i = 0; i < channelSize; i++) {
    input[i] = pixels[i * 4] / 255;
    input[channelSize + i] = pixels[i * 4 + 1] / 255;
    input[channelSize * 2 + i] = pixels[i * 4 + 2] / 255;
  }

  return new ort.Tensor("float32", input, [1, 3, MODEL_SIZE, MODEL_SIZE]);
}

export async function imageBufferToTensor(
  buffer: ArrayBuffer
): Promise<ort.Tensor> {
  const blob = new Blob([buffer], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  try {
    return await imageToTensor(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
