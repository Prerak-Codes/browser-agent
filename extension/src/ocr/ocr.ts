export interface OCRDetection {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function initializeOCR(
  onProgress?: (message: string) => void
): Promise<void> {
  onProgress?.("OCR engine ready.");
}

async function detectWithBackendOCR(imageSrc: string): Promise<OCRDetection[]> {
  const API_URL = "http://localhost:8000";
  const response = await fetch(`${API_URL}/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageSrc }),
  });
  if (!response.ok) throw new Error(`Backend OCR failed: ${response.status}`);
  const data = await response.json();
  if (!data.success) throw new Error(data.error || "Backend OCR failed");
  return (data.regions || []).filter(
    (r: OCRDetection) => r.text.length > 0 && r.confidence > 0.3
  );
}

export async function detectText(
  imageSrc: string,
  onProgress?: (message: string) => void
): Promise<OCRDetection[]> {
  onProgress?.("Running OCR on screenshot...");

  const ocrResults: OCRDetection[] = [];

  try {
    const regions = await detectWithBackendOCR(imageSrc);
    ocrResults.push(...regions);
    onProgress?.(`Image OCR found ${regions.length} text regions.`);
  } catch (err) {
    console.error("[OCR] Backend OCR error:", err);
  }

  try {
    const domResults = await extractDOMText();
    ocrResults.push(...domResults);
    onProgress?.(`DOM extraction found ${domResults.length} text regions.`);
  } catch (err) {
    console.error("[OCR] DOM extraction error:", err);
  }

  onProgress?.(`Total: ${ocrResults.length} text regions.`);
  return ocrResults;
}

async function extractDOMText(): Promise<OCRDetection[]> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return [];

  const tabId = tab.id;

  await new Promise<void>((resolve) => {
    chrome.runtime.sendMessage({ action: "ensureContentScript", tabId }, () => resolve());
  });

  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { action: "extractText" },
      (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          resolve([]);
          return;
        }
        const results = response.results as OCRDetection[];
        resolve(results);
      }
    );
  });
}

export async function terminateOCR(): Promise<void> {}
