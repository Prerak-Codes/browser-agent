interface PageDetection {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OverlayRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
  text?: string;
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
    "input, textarea, select, label, h1, h2, h3, h4, h5, h6, p, span, a, button, td, th, li, div[role], div[class]";
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

    if (text.length === 0 || text.length > 500) continue;

    const skipTags = ["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG", "IMG"];
    if (skipTags.includes(el.tagName)) continue;

    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;

    const skipRoles = ["navigation", "banner", "contentinfo", "button", "img", "icon", "presentation", "none"];
    const role = el.getAttribute("role");
    if (role && skipRoles.includes(role)) continue;

    const detection: PageDetection = {
      text: text.substring(0, 500),
      confidence: 0.9,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };

    if (!isValidRegion(detection, viewW, viewH)) continue;

    results.push(detection);
  }

  return deduplicateOCR(results);
}

let overlayEl: HTMLDivElement | null = null;
let rafId: number | null = null;
let baseScrollX = 0;
let baseScrollY = 0;
let boxOriginals: Array<{
  left: number;
  top: number;
  width: number;
  height: number;
}> = [];
let scrollContainer: Element | null = null;
let containerBaseScrollTop = 0;

function findScrollContainer(): Element | null {
  let best: Element | null = null;
  let bestScrollHeight = 0;
  const all = document.querySelectorAll("*");
  for (const el of all) {
    if (el === overlayEl || el === document.documentElement) continue;
    const style = getComputedStyle(el);
    if (style.overflowY === "auto" || style.overflowY === "scroll") {
      if (el.scrollHeight > el.clientHeight + 10 && el.scrollHeight > bestScrollHeight) {
        best = el;
        bestScrollHeight = el.scrollHeight;
      }
    }
  }
  return best;
}

function onScroll() {
  if (!overlayEl || boxOriginals.length === 0) return;

  const deltaX = window.scrollX - baseScrollX;
  const deltaY = window.scrollY - baseScrollY;

  let containerDeltaY = 0;
  if (scrollContainer) {
    containerDeltaY = scrollContainer.scrollTop - containerBaseScrollTop;
  }

  const totalDeltaY = deltaY + containerDeltaY;

  const boxes = overlayEl.querySelectorAll<HTMLElement>("[data-pg-idx]");
  for (const box of boxes) {
    const idx = parseInt(box.dataset.pgIdx || "0", 10);
    const orig = boxOriginals[idx];
    if (!orig) continue;
    box.style.left = (orig.left - deltaX) + "px";
    box.style.top = (orig.top - totalDeltaY) + "px";
  }
}

function throttledScroll() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    onScroll();
  });
}

function renderBlurOverlay(regions: OverlayRegion[]) {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
  }
  window.removeEventListener("scroll", throttledScroll, true);
  window.removeEventListener("resize", throttledScroll);
  if (scrollContainer) {
    scrollContainer.removeEventListener("scroll", throttledScroll);
  }

  baseScrollX = window.scrollX;
  baseScrollY = window.scrollY;

  scrollContainer = findScrollContainer();
  containerBaseScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;

  const dpr = window.devicePixelRatio || 1;

  overlayEl = document.createElement("div");
  overlayEl.id = "privacyguard-overlay";
  overlayEl.style.cssText =
    "position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483647;";

  boxOriginals = [];

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (region.width <= 0 || region.height <= 0) continue;

    const cssX = region.x / dpr;
    const cssY = region.y / dpr;
    const cssW = region.width / dpr;
    const cssH = region.height / dpr;

    boxOriginals.push({ left: cssX, top: cssY, width: cssW, height: cssH });

    const box = document.createElement("div");
    box.dataset.pgIdx = String(boxOriginals.length - 1);
    box.style.cssText =
      `position:absolute;left:${cssX}px;top:${cssY}px;width:${cssW}px;height:${cssH}px;` +
      "backdrop-filter:blur(8px);background:rgba(0,0,0,0.15);border-radius:2px;";
    overlayEl.appendChild(box);
  }

  document.documentElement.appendChild(overlayEl);

  window.addEventListener("scroll", throttledScroll, { capture: true, passive: true });
  window.addEventListener("resize", throttledScroll, { passive: true });
  if (scrollContainer) {
    scrollContainer.addEventListener("scroll", throttledScroll, { passive: true });
  }

  console.log("[Content] Blur overlay rendered:", boxOriginals.length, "regions",
    scrollContainer ? "(scroll container detected)" : "(window scroll)");
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
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    window.removeEventListener("scroll", throttledScroll, true);
    window.removeEventListener("resize", throttledScroll);
    if (scrollContainer) {
      scrollContainer.removeEventListener("scroll", throttledScroll);
    }
    scrollContainer = null;
    boxOriginals = [];
    sendResponse({ success: true });
    return true;
  }

  return false;
});
