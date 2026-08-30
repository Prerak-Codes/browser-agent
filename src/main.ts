import {
    loadModel,
    detect
} from "./vision";

import type {
    Detection
} from "./vision";

import "./style.css";


const loadButton =
    document.getElementById(
        "loadModel"
    ) as HTMLButtonElement;


const testButton =
    document.getElementById(
        "testImage"
    ) as HTMLButtonElement;


const status =
    document.getElementById(
        "status"
    ) as HTMLParagraphElement;


const result =
    document.getElementById(
        "result"
    ) as HTMLDivElement;


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

            const image =
                "/test.png";

            const detections =
                await detect(image);

            drawDetections(
                image,
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

        /*
         * Draw original image
         */

        ctx.drawImage(
            image,
            0,
            0
        );


        /*
         * Scale from 640x640
         * back to original image
         */

        const scaleX =
            image.width / 640;

        const scaleY =
            image.height / 640;


        /*
         * Draw bounding boxes
         */

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


                /*
                 * Label
                 */

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