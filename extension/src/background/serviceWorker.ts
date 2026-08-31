const OFFSCREEN_URL = "offscreen.html";

async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Run YOLO object detection locally using WebGL/WebGPU",
  });
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["contentScript.js"],
    });
  }
}

function detectWithOffscreen(image: string): Promise<{ success: boolean; detections?: unknown[]; error?: string }> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "offscreenDetect", image }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "capture") {
    chrome.tabs.captureVisibleTab(
      undefined as unknown as number,
      { format: "png" },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        sendResponse({ success: true, image: dataUrl });
      }
    );
    return true;
  }

  if (message.action === "getTabInfo") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs[0]) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError?.message || "No active tab",
        });
        return;
      }
      const tab = tabs[0];
      let hostname = "";
      try {
        hostname = new URL(tab.url || "").hostname;
      } catch {
        hostname = tab.url || "unknown";
      }
      sendResponse({
        success: true,
        tabId: tab.id,
        url: tab.url,
        hostname,
        title: tab.title,
      });
    });
    return true;
  }

  if (message.action === "detectYolo") {
    (async () => {
      try {
        await ensureOffscreenDocument();
        const response = await detectWithOffscreen(message.image);
        sendResponse(response);
      } catch (err) {
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return true;
  }

  if (message.action === "ensureContentScript") {
    const tabId = sender.tab?.id ?? message.tabId;
    if (!tabId) {
      sendResponse({ success: false, error: "No tab ID" });
      return true;
    }
    ensureContentScript(tabId)
      .then(() => sendResponse({ success: true }))
      .catch((err) =>
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    return true;
  }

  return false;
});
