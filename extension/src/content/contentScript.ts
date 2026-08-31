interface PageDetection {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function extractPageText(): PageDetection[] {
  const results: PageDetection[] = [];
  const selectors = "input, textarea, select, label, h1, h2, h3, h4, h5, h6, p, span, a, button, td, th, li";
  const elements = document.querySelectorAll(selectors);

  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    let text = "";
    const input = el as HTMLInputElement;

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      text = input.placeholder || input.getAttribute("aria-label") || input.name || input.type || "";
    } else if (el.tagName === "SELECT") {
      text = el.getAttribute("aria-label") || el.id || "select";
    } else {
      text = (el.textContent || "").trim();
    }

    if (text.length === 0 || text.length > 200) continue;

    const skipTags = ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME"];
    if (skipTags.includes(el.tagName)) continue;

    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;

    results.push({
      text: text.substring(0, 200),
      confidence: 0.9,
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    });
  }

  return results;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[Content] Received message:", message.action);

  if (message.action === "ping") {
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "extractText") {
    const results = extractPageText();
    console.log("[Content] Text extraction:", results.length, "regions");
    sendResponse({ success: true, results });
    return true;
  }

  if (message.action === "contentDetect") {
    console.log("[Content] Injecting YOLO script into page...");
    injectYoloScript(message.image);
    const handler = (e: CustomEvent) => {
      console.log("[Content] Received YOLO result:", e.detail?.length, "detections");
      window.removeEventListener("pg-yolo-result", handler as EventListener);
      sendResponse({ success: true, detections: e.detail });
    };
    window.addEventListener("pg-yolo-result", handler as EventListener);
    return true;
  }

  return false;
});

function injectYoloScript(imageSrc: string) {
  const modelUrl = chrome.runtime.getURL("model/yolov8n.onnx");
  const wasmDir = chrome.runtime.getURL("ort/");
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("assets/yolo-page.js");
  script.dataset.pgImage = imageSrc;
  script.dataset.pgModel = modelUrl;
  script.dataset.pgWasmDir = wasmDir;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}
