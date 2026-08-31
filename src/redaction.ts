import type {
    SensitiveRegion
} from "./privacy";

import {
    DEFAULT_POLICY
} from "./privacy";

import type {
    PrivacyPolicy
} from "./privacy";


function applyMask(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
): void {

    ctx.fillStyle =
        "#000000";

    ctx.fillRect(
        x,
        y,
        width,
        height
    );
}


function applyBlur(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
): void {

    const radius = 10;

    ctx.filter =
        `blur(${radius}px)`;

    ctx.drawImage(
        ctx.canvas,
        x,
        y,
        width,
        height,
        x,
        y,
        width,
        height
    );

    ctx.filter = "none";
}


function applyPixelate(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number
): void {

    const pixelSize = 10;

    const safeW =
        Math.max(
            1,
            Math.floor(width)
        );

    const safeH =
        Math.max(
            1,
            Math.floor(height)
        );

    const imageData =
        ctx.getImageData(
            x,
            y,
            safeW,
            safeH
        );

    const data =
        imageData.data;

    for (
        let py = 0;
        py < safeH;
        py += pixelSize
    ) {

        for (
            let px = 0;
            px < safeW;
            px += pixelSize
        ) {

            const i =
                (py * safeW + px) * 4;

            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            for (
                let dy = 0;
                dy <
                pixelSize &&
                py + dy < safeH;
                dy++
            ) {

                for (
                    let dx = 0;
                    dx <
                    pixelSize &&
                    px + dx < safeW;
                    dx++
                ) {

                    const j =
                        ((py + dy) *
                            safeW +
                            (px + dx)) *
                        4;

                    data[j] = r;
                    data[j + 1] = g;
                    data[j + 2] = b;

                }

            }

        }

    }

    ctx.putImageData(
        imageData,
        x,
        y
    );
}


function applyRedaction(
    ctx: CanvasRenderingContext2D,
    region: SensitiveRegion,
    action:
        | "blur"
        | "mask"
        | "pixelate"
        | "redact"
): void {

    const x =
        Math.max(0, region.x);

    const y =
        Math.max(0, region.y);

    const w =
        Math.min(
            region.width,
            ctx.canvas.width - x
        );

    const h =
        Math.min(
            region.height,
            ctx.canvas.height - y
        );

    if (w <= 0 || h <= 0) {
        return;
    }

    switch (action) {

        case "mask":
        case "redact":
            applyMask(
                ctx,
                x,
                y,
                w,
                h
            );
            break;

        case "blur":
            applyBlur(
                ctx,
                x,
                y,
                w,
                h
            );
            break;

        case "pixelate":
            applyPixelate(
                ctx,
                x,
                y,
                w,
                h
            );
            break;

    }
}


export async function redactImage(
    imageSrc: string,
    sensitiveRegions: SensitiveRegion[],
    policy: PrivacyPolicy =
        DEFAULT_POLICY
): Promise<string> {

    return new Promise(
        (resolve, reject) => {

            const image =
                new Image();

            image.src = imageSrc;

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
                    canvas.getContext("2d");

                if (!ctx) {
                    reject(
                        new Error(
                            "Could not create canvas context"
                        )
                    );
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

                for (
                    const region of
                    sensitiveRegions
                ) {

                    const scaled =
                        region.source ===
                        "vision"
                            ? {
                                ...region,
                                x:
                                    region.x *
                                    scaleX,
                                y:
                                    region.y *
                                    scaleY,
                                width:
                                    region.width *
                                    scaleX,
                                height:
                                    region.height *
                                    scaleY
                            }
                            : region;

                    const action =
                        policy[
                        scaled.type
                        ];

                    applyRedaction(
                        ctx,
                        scaled,
                        action
                    );

                }

                const dataURL =
                    canvas.toDataURL(
                        "image/png"
                    );

                resolve(dataURL);

            };

            image.onerror = () => {
                reject(
                    new Error(
                        `Could not load image: ${imageSrc}`
                    )
                );
            };

        }
    );
}
