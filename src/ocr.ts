import Tesseract from "tesseract.js";

export interface OCRDetection {
    text: string;
    confidence: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

const OCR_CONFIDENCE_THRESHOLD = 40;

let worker: Tesseract.Worker | null = null;

export async function initializeOCR(
    onProgress?: (message: string) => void
): Promise<void> {

    if (worker) {
        return;
    }

    onProgress?.("Initializing OCR...");

    worker = await Tesseract.createWorker(
        "eng",
        undefined,
        {
            logger: (msg) => {

                if (msg.status === "loading language traineddata") {
                    onProgress?.("Loading language...");
                }

                if (msg.status === "initializing api") {
                    onProgress?.("Initializing API...");
                }

            }
        }
    );

    onProgress?.("OCR ready.");
}

export async function detectText(
    imageSrc: string,
    onProgress?: (message: string) => void
): Promise<OCRDetection[]> {

    if (!worker) {
        throw new Error(
            "OCR worker not initialized. Call initializeOCR() first."
        );
    }

    onProgress?.("Recognizing text...");

    const result = await worker.recognize(
        imageSrc,
        {},
        { blocks: true }
    );

    const detections: OCRDetection[] = [];

    const blocks = result.data.blocks;

    if (blocks) {

        for (const block of blocks) {

            for (const paragraph of block.paragraphs) {

                for (const line of paragraph.lines) {

                    for (const word of line.words) {

                        if (
                            word.confidence <
                            OCR_CONFIDENCE_THRESHOLD
                        ) {
                            continue;
                        }

                        const trimmed =
                            word.text.trim();

                        if (trimmed.length === 0) {
                            continue;
                        }

                        detections.push({
                            text: trimmed,
                            confidence:
                                word.confidence,
                            x: word.bbox.x0,
                            y: word.bbox.y0,
                            width:
                                word.bbox.x1 -
                                word.bbox.x0,
                            height:
                                word.bbox.y1 -
                                word.bbox.y0
                        });

                    }

                }

            }

        }

    }

    onProgress?.(
        `OCR completed: ${detections.length} words detected.`
    );

    return detections;
}

export async function terminateOCR(): Promise<void> {

    if (!worker) {
        return;
    }

    await worker.terminate();
    worker = null;
}
