import type { Detection } from "../vision/types";
import type { OCRDetection } from "../ocr/ocr";
import type { CustomPattern } from "./policies";

export interface SensitiveRegion {
  type: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  source: "vision" | "ocr" | "rule";
  text?: string;
}

const EMAIL_REGEX =
  /\b[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}\b/gi;

const PHONE_REGEX =
  /(?:\+91[\s\-]?)?(?:\d{5}[\s\-]\d{5}|\d{10})/g;

const AADHAAR_REGEX = /\b\d{4}[\s]?\d{4}[\s]?\d{4}\b/g;

const CREDIT_CARD_REGEX = /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g;

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

const PASSWORD_KEYWORDS = [
  "password",
  "passcode",
  "passwd",
  "pwd",
  "secret",
  "pin",
];

function estimateSubstringBounds(
  fullText: string,
  substring: string,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
): { x: number; y: number; width: number; height: number } {
  const startIdx = fullText.indexOf(substring);
  if (startIdx === -1) {
    return { x: boxX, y: boxY, width: boxW, height: boxH };
  }
  const charWidth = boxW / fullText.length;
  return {
    x: boxX + startIdx * charWidth,
    y: boxY,
    width: substring.length * charWidth,
    height: boxH,
  };
}

function maskValue(value: string): string {
  if (value.length <= 4) return "****";
  const visible = value.slice(-4);
  const masked = "*".repeat(value.length - 4);
  return masked + visible;
}

function detectEmails(ocrDetections: OCRDetection[]): SensitiveRegion[] {
  const results: SensitiveRegion[] = [];
  const seen = new Set<string>();

  for (const detection of ocrDetections) {
    const matches = detection.text.match(EMAIL_REGEX);
    if (!matches) continue;

    for (const match of matches) {
      const key = match.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const bounds = estimateSubstringBounds(
        detection.text,
        match,
        detection.x,
        detection.y,
        detection.width,
        detection.height
      );

      results.push({
        type: "email",
        confidence: 0.95,
        ...bounds,
        source: "ocr",
        text: maskValue(match),
      });
    }
  }

  return results;
}

function detectPhones(ocrDetections: OCRDetection[]): SensitiveRegion[] {
  const results: SensitiveRegion[] = [];
  const seen = new Set<string>();

  for (const detection of ocrDetections) {
    const matches = detection.text.match(PHONE_REGEX);
    if (!matches) continue;

    for (const match of matches) {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 13) continue;

      if (digits.length >= 12) continue;

      const key = digits;
      if (seen.has(key)) continue;
      seen.add(key);

      const bounds = estimateSubstringBounds(
        detection.text,
        match,
        detection.x,
        detection.y,
        detection.width,
        detection.height
      );

      results.push({
        type: "phone",
        confidence: 0.9,
        ...bounds,
        source: "ocr",
        text: maskValue(digits),
      });
    }
  }

  return results;
}

function detectPasswords(ocrDetections: OCRDetection[]): SensitiveRegion[] {
  const results: SensitiveRegion[] = [];
  const seen = new Set<string>();

  for (const detection of ocrDetections) {
    const lower = detection.text.toLowerCase();
    const hasKeyword = PASSWORD_KEYWORDS.some(
      (kw) => lower.includes(kw + ":") || lower.includes(kw + " =") || lower === kw
    );
    if (!hasKeyword) continue;

    const key = `${detection.x},${detection.y}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      type: "password",
      confidence: 0.8,
      x: detection.x,
      y: detection.y,
      width: detection.width,
      height: detection.height,
      source: "rule",
      text: maskValue(detection.text),
    });
  }

  return results;
}

function detectAadhaar(ocrDetections: OCRDetection[]): SensitiveRegion[] {
  const results: SensitiveRegion[] = [];
  const seen = new Set<string>();

  for (const detection of ocrDetections) {
    const matches = detection.text.match(AADHAAR_REGEX);
    if (!matches) continue;

    for (const match of matches) {
      const digits = match.replace(/\D/g, "");
      if (digits.length !== 12) continue;

      const key = digits;
      if (seen.has(key)) continue;
      seen.add(key);

      const bounds = estimateSubstringBounds(
        detection.text,
        match,
        detection.x,
        detection.y,
        detection.width,
        detection.height
      );

      results.push({
        type: "aadhaar",
        confidence: 0.85,
        ...bounds,
        source: "ocr",
        text: maskValue(digits),
      });
    }
  }

  return results;
}

function detectCreditCards(ocrDetections: OCRDetection[]): SensitiveRegion[] {
  const results: SensitiveRegion[] = [];
  const seen = new Set<string>();

  for (const detection of ocrDetections) {
    const matches = detection.text.match(CREDIT_CARD_REGEX);
    if (!matches) continue;

    for (const match of matches) {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) continue;

      if (/^\d{10,13}$/.test(digits)) continue;

      const key = digits;
      if (seen.has(key)) continue;
      seen.add(key);

      const bounds = estimateSubstringBounds(
        detection.text,
        match,
        detection.x,
        detection.y,
        detection.width,
        detection.height
      );

      results.push({
        type: "credit_card",
        confidence: 0.92,
        ...bounds,
        source: "ocr",
        text: maskValue(digits),
      });
    }
  }

  return results;
}

function detectFaces(visionDetections: Detection[]): SensitiveRegion[] {
  return visionDetections
    .filter((d) => d.className === "person")
    .map((d) => ({
      type: "face",
      confidence: d.confidence * 0.8,
      x: d.x,
      y: d.y,
      width: d.width,
      height: d.height,
      source: "vision" as const,
      text: undefined,
    }));
}

function detectCustomPatterns(
  ocrDetections: OCRDetection[],
  patterns: CustomPattern[]
): SensitiveRegion[] {
  const results: SensitiveRegion[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern.regex, "gi");
    } catch {
      continue;
    }

    for (const detection of ocrDetections) {
      const matches = detection.text.match(regex);
      if (!matches) continue;

      for (const match of matches) {
        const key = `${pattern.name}:${match.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const bounds = estimateSubstringBounds(
          detection.text,
          match,
          detection.x,
          detection.y,
          detection.width,
          detection.height
        );

        results.push({
          type: pattern.name,
          confidence: 0.85,
          ...bounds,
          source: "ocr",
          text: match.length > 4 ? maskValue(match) : match,
        });
      }
    }
  }

  return results;
}

function deduplicateRegions(regions: SensitiveRegion[]): SensitiveRegion[] {
  const result: SensitiveRegion[] = [];
  for (const region of regions) {
    const isDup = result.some(
      (existing) =>
        existing.type === region.type &&
        existing.text === region.text &&
        computeIoU(existing, region) > 0.5
    );
    if (!isDup) result.push(region);
  }
  return result;
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
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export function detectSensitiveRegions(
  ocrDetections: OCRDetection[],
  visionDetections: Detection[],
  customPatterns: CustomPattern[] = []
): SensitiveRegion[] {
  console.log("[PG] detectSensitiveRegions called with", ocrDetections.length, "OCR and", visionDetections.length, "vision and", customPatterns.length, "custom patterns");

  const emailRegions = detectEmails(ocrDetections);
  const phoneRegions = detectPhones(ocrDetections);
  const passwordRegions = detectPasswords(ocrDetections);
  const aadhaarRegions = detectAadhaar(ocrDetections);
  const creditCardRegions = detectCreditCards(ocrDetections);
  const faceRegions = detectFaces(visionDetections);
  const customRegions = detectCustomPatterns(ocrDetections, customPatterns);

  console.log("[PG] Email regions:", emailRegions.length);
  console.log("[PG] Phone regions:", phoneRegions.length);
  console.log("[PG] Password regions:", passwordRegions.length);
  console.log("[PG] Aadhaar regions:", aadhaarRegions.length);
  console.log("[PG] Credit card regions:", creditCardRegions.length);
  console.log("[PG] Face regions:", faceRegions.length);
  console.log("[PG] Custom pattern regions:", customRegions.length);

  const all = [
    ...emailRegions,
    ...phoneRegions,
    ...passwordRegions,
    ...aadhaarRegions,
    ...creditCardRegions,
    ...faceRegions,
    ...customRegions,
  ];

  const deduped = deduplicateRegions(all);
  console.log("[PG] Regions after dedup:", deduped.length);

  for (const r of deduped) {
    console.log(`[PG]   ${r.type}: "${r.text || "N/A"}" at (${Math.round(r.x)}, ${Math.round(r.y)}) ${Math.round(r.width)}x${Math.round(r.height)} source=${r.source}`);
  }

  return deduped;
}
