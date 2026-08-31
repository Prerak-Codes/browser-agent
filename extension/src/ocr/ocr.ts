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
  onProgress?.("Text extraction ready.");
}

export async function detectText(
  _imageSrc: string,
  onProgress?: (message: string) => void
): Promise<OCRDetection[]> {
  onProgress?.("Extracting text from page DOM...");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    onProgress?.("No active tab found.");
    return [];
  }
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
          onProgress?.("Could not access page content.");
          resolve([]);
          return;
        }
        const results = response.results as OCRDetection[];
        onProgress?.(`Found ${results.length} text regions from page.`);
        resolve(results);
      }
    );
  });
}

export async function terminateOCR(): Promise<void> {}
