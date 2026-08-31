import type { Detection } from "./types";

export async function detect(imageSrc: string): Promise<Detection[]> {
  console.log("[PG] Sending screenshot to offscreen document for YOLO detection...");

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "detectYolo", image: imageSrc },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.success) {
          reject(new Error(response?.error || "YOLO detection failed"));
          return;
        }
        console.log("[PG] YOLO detections:", response.detections.length);
        resolve(response.detections);
      }
    );
  });
}
