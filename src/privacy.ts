import type {
    Detection
} from "./vision";

import type {
    OCRDetection
} from "./ocr";


export type PrivacyType =
    | "face"
    | "email"
    | "phone"
    | "password"
    | "credit_card"
    | "aadhaar";


export interface SensitiveRegion {
    type: PrivacyType;
    confidence: number;

    x: number;
    y: number;
    width: number;
    height: number;

    source: "vision" | "ocr" | "rule";
    text?: string;
}


export interface PrivacyPolicy {
    face: "blur" | "mask" | "pixelate";
    email: "blur" | "mask" | "redact";
    phone: "blur" | "mask" | "redact";
    password: "blur" | "mask" | "redact";
    credit_card: "blur" | "mask" | "redact";
    aadhaar: "blur" | "mask" | "redact";
}


export const DEFAULT_POLICY: PrivacyPolicy = {
    face: "blur",
    email: "mask",
    phone: "mask",
    password: "redact",
    credit_card: "mask",
    aadhaar: "mask"
};


const EMAIL_REGEX =
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const PHONE_REGEX =
    /(?:\+91[\s\-]?)?(?:\d{5}[\s\-]?\d{5}|\d{10})/g;

const AADHAAR_REGEX =
    /\b\d{4}[\s]?\d{4}[\s]?\d{4}\b/g;

const CREDIT_CARD_REGEX =
    /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g;


const PASSWORD_KEYWORDS = [
    "password",
    "passcode",
    "passwd",
    "pwd",
    "secret",
    "pin"
];


function groupByLine(
    words: OCRDetection[]
): OCRDetection[][] {

    const sorted =
        [...words].sort(
            (a, b) => a.y - b.y
        );

    const lines: OCRDetection[][] = [];

    let currentLine: OCRDetection[] =
        sorted.length > 0
            ? [sorted[0]]
            : [];

    for (
        let i = 1;
        i < sorted.length;
        i++
    ) {

        const prev =
            currentLine[
            currentLine.length - 1
            ];

        const verticalGap =
            Math.abs(
                sorted[i].y - prev.y
            );

        if (
            verticalGap >
            prev.height * 0.5
        ) {

            lines.push(currentLine);

            currentLine = [sorted[i]];

        } else {

            currentLine.push(sorted[i]);

        }

    }

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines;
}


function maskValue(
    value: string
): string {

    if (value.length <= 4) {
        return "****";
    }

    const visible =
        value.slice(-4);

    const masked =
        "*".repeat(
            value.length - 4
        );

    return masked + visible;
}


function detectEmails(
    ocrDetections: OCRDetection[]
): SensitiveRegion[] {

    const results: SensitiveRegion[] = [];

    for (const detection of ocrDetections) {

        const matches =
            detection.text.match(EMAIL_REGEX);

        if (!matches) {
            continue;
        }

        for (const match of matches) {

            const startIdx =
                detection.text.indexOf(match);

            const charWidth =
                detection.width /
                detection.text.length;

            results.push({
                type: "email",
                confidence: 0.95,
                x:
                    detection.x +
                    startIdx * charWidth,
                y: detection.y,
                width:
                    match.length * charWidth,
                height: detection.height,
                source: "ocr",
                text: maskValue(match)
            });

        }

    }

    return results;
}


function detectPhones(
    ocrDetections: OCRDetection[]
): SensitiveRegion[] {

    const results: SensitiveRegion[] = [];

    for (const detection of ocrDetections) {

        const matches =
            detection.text.match(PHONE_REGEX);

        if (!matches) {
            continue;
        }

        for (const match of matches) {

            const digits =
                match.replace(/\D/g, "");

            if (
                digits.length < 10 ||
                digits.length > 13
            ) {
                continue;
            }

            const startIdx =
                detection.text.indexOf(match);

            const charWidth =
                detection.width /
                detection.text.length;

            results.push({
                type: "phone",
                confidence: 0.90,
                x:
                    detection.x +
                    startIdx * charWidth,
                y: detection.y,
                width:
                    match.length * charWidth,
                height: detection.height,
                source: "ocr",
                text: maskValue(digits)
            });

        }

    }

    return results;
}


function detectPasswords(
    ocrDetections: OCRDetection[]
): SensitiveRegion[] {

    const results: SensitiveRegion[] = [];

    const lines =
        groupByLine(ocrDetections);

    for (const line of lines) {

        for (
            let i = 0;
            i < line.length;
            i++
        ) {

            const word =
                line[i].text
                    .toLowerCase()
                    .replace(/[:\s]/g, "");

            const isKeyword =
                PASSWORD_KEYWORDS.some(
                    (kw) =>
                        word === kw ||
                        word ===
                        kw.replace(/\s/g, "")
                );

            if (!isKeyword) {
                continue;
            }

            const remaining =
                line.slice(i + 1);

            if (remaining.length === 0) {
                continue;
            }

            const valueText =
                remaining
                    .map((w) => w.text)
                    .join(" ");

            if (
                valueText.trim().length === 0
            ) {
                continue;
            }

            const firstWord = remaining[0];

            const lastWord =
                remaining[
                remaining.length - 1
                ];

            results.push({
                type: "password",
                confidence: 0.80,
                x: firstWord.x,
                y: Math.min(
                    line[i].y,
                    firstWord.y
                ),
                width:
                    lastWord.x +
                    lastWord.width -
                    firstWord.x,
                height: Math.max(
                    line[i].height,
                    firstWord.height
                ),
                source: "rule",
                text: maskValue(valueText)
            });

            break;

        }

    }

    return results;
}


function detectAadhaar(
    ocrDetections: OCRDetection[]
): SensitiveRegion[] {

    const results: SensitiveRegion[] = [];

    for (const detection of ocrDetections) {

        const matches =
            detection.text.match(
                AADHAAR_REGEX
            );

        if (!matches) {
            continue;
        }

        for (const match of matches) {

            const digits =
                match.replace(/\D/g, "");

            if (digits.length !== 12) {
                continue;
            }

            const startIdx =
                detection.text.indexOf(match);

            const charWidth =
                detection.width /
                detection.text.length;

            results.push({
                type: "aadhaar",
                confidence: 0.85,
                x:
                    detection.x +
                    startIdx * charWidth,
                y: detection.y,
                width:
                    match.length * charWidth,
                height: detection.height,
                source: "ocr",
                text: maskValue(digits)
            });

        }

    }

    return results;
}


function detectCreditCards(
    ocrDetections: OCRDetection[]
): SensitiveRegion[] {

    const results: SensitiveRegion[] = [];

    for (const detection of ocrDetections) {

        const matches =
            detection.text.match(
                CREDIT_CARD_REGEX
            );

        if (!matches) {
            continue;
        }

        for (const match of matches) {

            const digits =
                match.replace(/\D/g, "");

            if (
                digits.length < 13 ||
                digits.length > 19
            ) {
                continue;
            }

            if (
                PHONE_REGEX.test(match)
            ) {
                continue;
            }

            const startIdx =
                detection.text.indexOf(match);

            const charWidth =
                detection.width /
                detection.text.length;

            results.push({
                type: "credit_card",
                confidence: 0.92,
                x:
                    detection.x +
                    startIdx * charWidth,
                y: detection.y,
                width:
                    match.length * charWidth,
                height: detection.height,
                source: "ocr",
                text: maskValue(digits)
            });

        }

    }

    return results;
}


function detectFaces(
    visionDetections: Detection[]
): SensitiveRegion[] {

    return visionDetections
        .filter(
            (d) =>
                d.className === "person"
        )
        .map((d) => ({
            type: "face" as PrivacyType,
            confidence:
                d.confidence * 0.8,
            x: d.x,
            y: d.y,
            width: d.width,
            height: d.height,
            source: "vision" as const,
            text: undefined
        }));
}


export function detectSensitiveRegions(
    ocrDetections: OCRDetection[],
    visionDetections: Detection[]
): SensitiveRegion[] {

    const emailRegions =
        detectEmails(ocrDetections);

    const phoneRegions =
        detectPhones(ocrDetections);

    const passwordRegions =
        detectPasswords(ocrDetections);

    const aadhaarRegions =
        detectAadhaar(ocrDetections);

    const creditCardRegions =
        detectCreditCards(ocrDetections);

    const faceRegions =
        detectFaces(visionDetections);

    const all = [
        ...emailRegions,
        ...phoneRegions,
        ...passwordRegions,
        ...aadhaarRegions,
        ...creditCardRegions,
        ...faceRegions
    ];

    console.log(
        "Sensitive regions:",
        all
    );

    return all;
}
