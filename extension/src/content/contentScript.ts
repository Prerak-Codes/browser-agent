interface PageDetection {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

function isValidRegion(
  r: { x: number; y: number; width: number; height: number },
  viewW: number,
  viewH: number
): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0 &&
    r.x + r.width > 0 &&
    r.y + r.height > 0 &&
    r.x < viewW &&
    r.y < viewH
  );
}

function computeIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const unionA = a.width * a.height;
  const unionB = b.width * b.height;
  const union = unionA + unionB - inter;
  return union > 0 ? inter / union : 0;
}

function deduplicateOCR(items: PageDetection[]): PageDetection[] {
  const sorted = [...items].sort((a, b) => {
    if (a.text !== b.text) return a.text.localeCompare(b.text);
    return a.y - b.y;
  });
  const result: PageDetection[] = [];
  for (const item of sorted) {
    const isDup = result.some(
      (existing) =>
        existing.text === item.text &&
        computeIoU(existing, item) > 0.5
    );
    if (!isDup) result.push(item);
  }
  return result;
}

function extractPageText(): PageDetection[] {
  const results: PageDetection[] = [];
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;
  const selectors =
    "input, textarea, select, label, h1, h2, h3, h4, h5, h6, p, span, a, button, td, th, li";
  const elements = document.querySelectorAll(selectors);

  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    let text = "";
    const input = el as HTMLInputElement;

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      text =
        input.placeholder ||
        input.getAttribute("aria-label") ||
        input.name ||
        input.type ||
        "";
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

    const detection: PageDetection = {
      text: text.substring(0, 200),
      confidence: 0.9,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };

    if (!isValidRegion(detection, viewW, viewH)) continue;

    results.push(detection);
  }

  console.log("[Content] Raw text regions:", results.length);
  const deduped = deduplicateOCR(results);
  console.log("[Content] After deduplication:", deduped.length);
  return deduped;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[Content] Received message:", message.action);

  if (message.action === "ping") {
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "extractText") {
    const results = extractPageText();
    const dpr = window.devicePixelRatio || 1;
    const scaled = results.map((r) => ({
      ...r,
      x: r.x * dpr,
      y: r.y * dpr,
      width: r.width * dpr,
      height: r.height * dpr,
    }));
    console.log("[Content] Returning", scaled.length, "regions (DPR=" + dpr + ")");
    sendResponse({ success: true, results: scaled });
    return true;
  }

  if (message.action === "renderOverlay") {
    renderBlurOverlay(message.regions);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "removeOverlay") {
    const el = document.getElementById("privacyguard-overlay");
    if (el) el.remove();
    sendResponse({ success: true });
    return true;
  }

  return false;
});

function renderBlurOverlay(regions: Array<{
  x: number; y: number; width: number; height: number; type: string;
}>) {
  let overlay = document.getElementById("privacyguard-overlay");
  if (overlay) overlay.remove();

  const dpr = window.devicePixelRatio || 1;

  overlay = document.createElement("div");
  overlay.id = "privacyguard-overlay";
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    pointer-events: none; z-index: 2147483647;
  `;

  for (const region of regions) {
    if (region.width <= 0 || region.height <= 0) continue;

    const cssX = region.x / dpr;
    const cssY = region.y / dpr;
    const cssW = region.width / dpr;
    const cssH = region.height / dpr;

    const box = document.createElement("div");
    box.style.cssText = `
      position: absolute;
      left: ${cssX}px; top: ${cssY}px;
      width: ${cssW}px; height: ${cssH}px;
      backdrop-filter: blur(8px);
      background: rgba(0,0,0,0.15);
      border-radius: 2px;
    `;
    overlay.appendChild(box);
  }

  document.documentElement.appendChild(overlay);
  console.log("[Content] Rendered blur overlay with", regions.length, "regions");
}
