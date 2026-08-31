import type { SensitiveRegion } from "./piiDetector";
import type { PrivacyAction, PrivacyPolicy } from "./policies";
import { DEFAULT_PRIVACY_POLICY } from "./policies";

function applyMask(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  ctx.fillStyle = "#000000";
  ctx.fillRect(x, y, width, height);
}

function applyBlur(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  const radius = 10;
  ctx.filter = `blur(${radius}px)`;
  ctx.drawImage(ctx.canvas, x, y, width, height, x, y, width, height);
  ctx.filter = "none";
}

function applyRedaction(
  ctx: CanvasRenderingContext2D,
  region: SensitiveRegion,
  action: PrivacyAction
): void {
  const x = Math.max(0, region.x);
  const y = Math.max(0, region.y);
  const w = Math.min(region.width, ctx.canvas.width - x);
  const h = Math.min(region.height, ctx.canvas.height - y);

  if (w <= 0 || h <= 0) return;

  switch (action) {
    case "mask":
    case "redact":
      applyMask(ctx, x, y, w, h);
      break;
    case "blur":
      applyBlur(ctx, x, y, w, h);
      break;
    case "allow":
      break;
  }
}

export async function redactImage(
  imageSrc: string,
  sensitiveRegions: SensitiveRegion[],
  policy: PrivacyPolicy = DEFAULT_PRIVACY_POLICY
): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.src = imageSrc;

    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not create canvas context"));
        return;
      }

      ctx.drawImage(image, 0, 0);

      const scaleX = image.width / 640;
      const scaleY = image.height / 640;

      for (const region of sensitiveRegions) {
        const scaled =
          region.source === "vision"
            ? {
                ...region,
                x: region.x * scaleX,
                y: region.y * scaleY,
                width: region.width * scaleX,
                height: region.height * scaleY,
              }
            : region;

        const action = policy[scaled.type];
        applyRedaction(ctx, scaled, action);
      }

      resolve(canvas.toDataURL("image/png"));
    };

    image.onerror = () => {
      reject(new Error(`Could not load image: ${imageSrc}`));
    };
  });
}
