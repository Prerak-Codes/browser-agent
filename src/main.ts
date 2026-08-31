import {
    loadModel,
    detect
} from "./vision";

import type {
    Detection
} from "./vision";

import {
    initializeOCR,
    detectText
} from "./ocr";

import type {
    OCRDetection
} from "./ocr";

import {
    detectSensitiveRegions
} from "./privacy";

import type {
    SensitiveRegion
} from "./privacy";

import {
    redactImage
} from "./redaction";

import "./style.css";


const loadButton =
    document.getElementById(
        "loadModel"
    ) as HTMLButtonElement;


const testButton =
    document.getElementById(
        "testImage"
    ) as HTMLButtonElement;


const ocrButton =
    document.getElementById(
        "runOCR"
    ) as HTMLButtonElement;


const analyzeButton =
    document.getElementById(
        "analyzePrivacy"
    ) as HTMLButtonElement;


const sanitizeButton =
    document.getElementById(
        "sanitizeScreen"
    ) as HTMLButtonElement;


const status =
    document.getElementById(
        "status"
    ) as HTMLParagraphElement;


const result =
    document.getElementById(
        "result"
    ) as HTMLDivElement;


const privacyReport =
    document.getElementById(
        "privacyReport"
    ) as HTMLDivElement;


let lastAnalysis: {
    visionDetections: Detection[];
    ocrDetections: OCRDetection[];
    sensitiveRegions: SensitiveRegion[];
} | null = null;


const TEST_IMAGE = "/test.png";


loadButton.addEventListener(
    "click",
    async () => {

        try {

            status.innerText =
                "Loading model...";

            await loadModel();

            status.innerText =
                "Model loaded successfully.";

        } catch (error) {

            console.error(error);

            status.innerText =
                "Model loading failed.";

        }

    }
);


testButton.addEventListener(
    "click",
    async () => {

        try {

            status.innerText =
                "Running detection...";

            result.innerHTML = "";

            const detections =
                await detect(
                    TEST_IMAGE
                );

            drawDetections(
                TEST_IMAGE,
                detections
            );

            status.innerText =
                `${detections.length} objects detected.`;

        } catch (error) {

            console.error(error);

            status.innerText =
                "Detection failed.";

        }

    }
);


ocrButton.addEventListener(
    "click",
    async () => {

        try {

            result.innerHTML = "";

            await initializeOCR(
                (msg) => {
                    status.innerText = msg;
                }
            );

            const ocrDetections =
                await detectText(
                    TEST_IMAGE,
                    (msg) => {
                        status.innerText = msg;
                    }
                );

            drawOCRBoxes(
                TEST_IMAGE,
                ocrDetections
            );

            status.innerText =
                `OCR completed: ${ocrDetections.length} words detected.`;

        } catch (error) {

            console.error(error);

            status.innerText =
                "OCR failed.";

        }

    }
);


analyzeButton.addEventListener(
    "click",
    async () => {

        try {

            result.innerHTML = "";
            privacyReport.innerHTML = "";

            status.innerText =
                "Running YOLO...";

            let visionDetections: Detection[] =
                [];

            try {

                visionDetections =
                    await detect(
                        TEST_IMAGE
                    );

            } catch (err) {

                console.error(
                    "YOLO failed:",
                    err
                );

                status.innerText =
                    "YOLO failed, continuing with OCR...";

            }

            status.innerText =
                "Running OCR...";

            let ocrDetections: OCRDetection[] =
                [];

            try {

                await initializeOCR(
                    (msg) => {
                        status.innerText = msg;
                    }
                );

                ocrDetections =
                    await detectText(
                        TEST_IMAGE,
                        (msg) => {
                            status.innerText = msg;
                        }
                    );

            } catch (err) {

                console.error(
                    "OCR failed:",
                    err
                );

                status.innerText =
                    "OCR failed, continuing...";

            }

            status.innerText =
                "Analyzing privacy...";

            const sensitiveRegions =
                detectSensitiveRegions(
                    ocrDetections,
                    visionDetections
                );

            lastAnalysis = {
                visionDetections,
                ocrDetections,
                sensitiveRegions
            };

            drawPrivacyAnalysis(
                TEST_IMAGE,
                visionDetections,
                ocrDetections,
                sensitiveRegions
            );

            showPrivacyReport(
                visionDetections,
                ocrDetections,
                sensitiveRegions
            );

            status.innerText =
                `Privacy analysis complete. ${sensitiveRegions.length} sensitive regions found.`;

        } catch (error) {

            console.error(error);

            status.innerText =
                "Privacy analysis failed.";

        }

    }
);


sanitizeButton.addEventListener(
    "click",
    async () => {

        try {

            if (!lastAnalysis) {

                status.innerText =
                    "Run Analyze Privacy first.";

                return;

            }

            status.innerText =
                "Sanitizing screenshot...";

            const sensitiveRegions =
                lastAnalysis.sensitiveRegions;

            const sanitizedDataURL =
                await redactImage(
                    TEST_IMAGE,
                    sensitiveRegions
                );

            result.innerHTML = "";

            showBeforeAfter(
                TEST_IMAGE,
                sanitizedDataURL
            );

            status.innerText =
                "✓ Privacy protection complete. " +
                "Raw screenshot retained locally.";

        } catch (error) {

            console.error(error);

            status.innerText =
                "Sanitization failed.";

        }

    }
);


function drawDetections(
    imageSrc: string,
    detections: Detection[]
): void {

    const image =
        new Image();

    image.src =
        imageSrc;

    image.onload = () => {

        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width =
            image.width;

        canvas.height =
            image.height;

        const ctx =
            canvas.getContext(
                "2d"
            );

        if (!ctx) {
            return;
        }

        ctx.drawImage(
            image,
            0,
            0
        );

        const scaleX =
            image.width / 640;

        const scaleY =
            image.height / 640;

        detections.forEach(
            (detection) => {

                const x =
                    detection.x *
                    scaleX;

                const y =
                    detection.y *
                    scaleY;

                const width =
                    detection.width *
                    scaleX;

                const height =
                    detection.height *
                    scaleY;

                ctx.strokeStyle =
                    "red";

                ctx.lineWidth =
                    3;

                ctx.strokeRect(
                    x,
                    y,
                    width,
                    height
                );

                ctx.fillStyle =
                    "red";

                ctx.font =
                    "16px Arial";

                ctx.fillText(
                    `${detection.className} ${(detection.confidence * 100).toFixed(1)}%`,
                    x,
                    Math.max(15, y - 5)
                );

            }
        );

        result.appendChild(
            canvas
        );

    };
}


function drawOCRBoxes(
    imageSrc: string,
    detections: OCRDetection[]
): void {

    const image =
        new Image();

    image.src =
        imageSrc;

    image.onload = () => {

        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width =
            image.width;

        canvas.height =
            image.height;

        const ctx =
            canvas.getContext(
                "2d"
            );

        if (!ctx) {
            return;
        }

        ctx.drawImage(
            image,
            0,
            0
        );

        detections.forEach(
            (detection) => {

                ctx.strokeStyle =
                    "blue";

                ctx.lineWidth =
                    2;

                ctx.strokeRect(
                    detection.x,
                    detection.y,
                    detection.width,
                    detection.height
                );

                ctx.fillStyle =
                    "blue";

                ctx.font =
                    "14px Arial";

                ctx.fillText(
                    `${detection.text} ${detection.confidence.toFixed(0)}%`,
                    detection.x,
                    Math.max(
                        15,
                        detection.y - 5
                    )
                );

            }
        );

        result.appendChild(
            canvas
        );

    };
}


function drawPrivacyAnalysis(
    imageSrc: string,
    visionDetections: Detection[],
    ocrDetections: OCRDetection[],
    sensitiveRegions: SensitiveRegion[]
): void {

    const image =
        new Image();

    image.src =
        imageSrc;

    image.onload = () => {

        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width =
            image.width;

        canvas.height =
            image.height;

        const ctx =
            canvas.getContext(
                "2d"
            );

        if (!ctx) {
            return;
        }

        ctx.drawImage(
            image,
            0,
            0
        );

        const scaleX =
            image.width / 640;

        const scaleY =
            image.height / 640;

        visionDetections.forEach(
            (d) => {

                const x =
                    d.x * scaleX;

                const y =
                    d.y * scaleY;

                const w =
                    d.width * scaleX;

                const h =
                    d.height * scaleY;

                ctx.strokeStyle =
                    "red";

                ctx.lineWidth =
                    2;

                ctx.strokeRect(
                    x,
                    y,
                    w,
                    h
                );

                ctx.fillStyle =
                    "red";

                ctx.font =
                    "14px Arial";

                ctx.fillText(
                    d.className,
                    x,
                    Math.max(14, y - 4)
                );

            }
        );

        ocrDetections.forEach(
            (d) => {

                ctx.strokeStyle =
                    "blue";

                ctx.lineWidth =
                    1;

                ctx.strokeRect(
                    d.x,
                    d.y,
                    d.width,
                    d.height
                );

            }
        );

        sensitiveRegions.forEach(
            (region) => {

                ctx.strokeStyle =
                    "orange";

                ctx.lineWidth =
                    4;

                ctx.strokeRect(
                    region.x,
                    region.y,
                    region.width,
                    region.height
                );

                ctx.fillStyle =
                    "orange";

                ctx.font =
                    "bold 14px Arial";

                ctx.fillText(
                    `${region.type.toUpperCase()}`,
                    region.x,
                    Math.max(
                        14,
                        region.y - 6
                    )
                );

            }
        );

        result.appendChild(
            canvas
        );

    };
}


function showPrivacyReport(
    visionDetections: Detection[],
    ocrDetections: OCRDetection[],
    sensitiveRegions: SensitiveRegion[]
): void {

    privacyReport.classList.add(
        "visible"
    );

    const emailCount =
        sensitiveRegions.filter(
            (r) => r.type === "email"
        ).length;

    const phoneCount =
        sensitiveRegions.filter(
            (r) => r.type === "phone"
        ).length;

    const passwordCount =
        sensitiveRegions.filter(
            (r) =>
                r.type === "password"
        ).length;

    const creditCardCount =
        sensitiveRegions.filter(
            (r) =>
                r.type === "credit_card"
        ).length;

    const aadhaarCount =
        sensitiveRegions.filter(
            (r) =>
                r.type === "aadhaar"
        ).length;

    const faceCount =
        sensitiveRegions.filter(
            (r) => r.type === "face"
        ).length;

    let html = "";

    html +=
        '<div class="report-section">';
    html +=
        '<div class="report-section-title">';
    html += "Privacy Analysis";
    html += "</div>";
    html += "</div>";

    html +=
        '<div class="report-section">';
    html += `Objects: ${visionDetections.length}`;
    html += "</div>";

    html +=
        '<div class="report-section">';
    html += `Text regions: ${ocrDetections.length}`;
    html += "</div>";

    html +=
        '<div class="report-section">';
    html +=
        `<strong>Sensitive regions: ${sensitiveRegions.length}</strong>`;
    html += "</div>";

    html +=
        '<div class="report-section">';
    html += `Email: ${emailCount}`;
    html += "</div>";

    html +=
        '<div class="report-section">';
    html += `Phone: ${phoneCount}`;
    html += "</div>";

    html +=
        '<div class="report-section">';
    html += `Credit Card: ${creditCardCount}`;
    html += "</div>";

    html +=
        '<div class="report-section">';
    html += `Aadhaar: ${aadhaarCount}`;
    html += "</div>";

    html +=
        '<div class="report-section">';
    html += `Password: ${passwordCount}`;
    html += "</div>";

    html +=
        '<div class="report-section">';
    html += `Face: ${faceCount}`;
    html += "</div>";

    for (
        const region of
        sensitiveRegions
    ) {

        html +=
            '<div class="report-item sensitive">';

        html +=
            '<span class="report-label">';
        html +=
            `${region.type}`;
        html += "</span>";

        if (region.text) {
            html += ` ${region.text}`;
        }

        html += "</div>";

    }

    privacyReport.innerHTML =
        html;

}


function showBeforeAfter(
    rawSrc: string,
    sanitizedDataURL: string
): void {

    const container =
        document.createElement("div");

    container.className =
        "before-after";

    const rawCol =
        document.createElement("div");

    rawCol.className =
        "before-after-column";

    const rawTitle =
        document.createElement("h3");

    rawTitle.textContent =
        "RAW SCREEN";

    rawCol.appendChild(
        rawTitle
    );

    const rawImg =
        new Image();

    rawImg.src =
        rawSrc;

    rawImg.onload = () => {

        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width =
            rawImg.width;

        canvas.height =
            rawImg.height;

        const ctx =
            canvas.getContext("2d");

        if (ctx) {

            ctx.drawImage(
                rawImg,
                0,
                0
            );

        }

        rawCol.appendChild(
            canvas
        );

    };

    const sanitizedCol =
        document.createElement("div");

    sanitizedCol.className =
        "before-after-column";

    const sanitizedTitle =
        document.createElement("h3");

    sanitizedTitle.textContent =
        "SANITIZED SCREEN";

    sanitizedCol.appendChild(
        sanitizedTitle
    );

    const sanitizedImg =
        new Image();

    sanitizedImg.src =
        sanitizedDataURL;

    sanitizedImg.onload = () => {

        const canvas =
            document.createElement(
                "canvas"
            );

        canvas.width =
            sanitizedImg.width;

        canvas.height =
            sanitizedImg.height;

        const ctx =
            canvas.getContext("2d");

        if (ctx) {

            ctx.drawImage(
                sanitizedImg,
                0,
                0
            );

        }

        sanitizedCol.appendChild(
            canvas
        );

    };

    container.appendChild(
        rawCol
    );

    container.appendChild(
        sanitizedCol
    );

    result.appendChild(
        container
    );

}
