import * as ort from "onnxruntime-web";

let session: ort.InferenceSession | null = null;

const MODEL_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.4;

const CLASS_NAMES: string[] = [
    "person",
    "bicycle",
    "car",
    "motorcycle",
    "airplane",
    "bus",
    "train",
    "truck",
    "boat",
    "traffic light",
    "fire hydrant",
    "stop sign",
    "parking meter",
    "bench",
    "bird",
    "cat",
    "dog",
    "horse",
    "sheep",
    "cow",
    "elephant",
    "bear",
    "zebra",
    "giraffe",
    "backpack",
    "umbrella",
    "handbag",
    "tie",
    "suitcase",
    "frisbee",
    "skis",
    "snowboard",
    "sports ball",
    "kite",
    "baseball bat",
    "baseball glove",
    "skateboard",
    "surfboard",
    "tennis racket",
    "bottle",
    "wine glass",
    "cup",
    "fork",
    "knife",
    "spoon",
    "bowl",
    "banana",
    "apple",
    "sandwich",
    "orange",
    "broccoli",
    "carrot",
    "hot dog",
    "pizza",
    "donut",
    "cake",
    "chair",
    "couch",
    "potted plant",
    "bed",
    "dining table",
    "toilet",
    "tv",
    "laptop",
    "mouse",
    "remote",
    "keyboard",
    "cell phone",
    "microwave",
    "oven",
    "toaster",
    "sink",
    "refrigerator",
    "book",
    "clock",
    "vase",
    "scissors",
    "teddy bear",
    "hair drier",
    "toothbrush"
];

export async function loadModel(): Promise<ort.InferenceSession> {

    if (session) {
        return session;
    }

    console.log("Loading YOLO model...");

    session = await ort.InferenceSession.create(
        "/model/yolov8n.onnx",
        {
            executionProviders: ["webgpu", "wasm"]
        }
    );

    console.log("Model loaded!");

    console.log(
        "Input:",
        session.inputNames
    );

    console.log(
        "Output:",
        session.outputNames
    );

    return session;
}


async function imageToTensor(
    imageSrc: string
): Promise<ort.Tensor> {

    const image = new Image();

    image.src = imageSrc;

    await new Promise<void>((resolve, reject) => {

        image.onload = () => resolve();

        image.onerror = () => {
            reject(
                new Error(
                    `Could not load image: ${imageSrc}`
                )
            );
        };

    });

    const canvas =
        document.createElement("canvas");

    canvas.width = MODEL_SIZE;
    canvas.height = MODEL_SIZE;

    const ctx =
        canvas.getContext("2d");

    if (!ctx) {
        throw new Error(
            "Could not create canvas context"
        );
    }

    ctx.drawImage(
        image,
        0,
        0,
        MODEL_SIZE,
        MODEL_SIZE
    );

    const imageData =
        ctx.getImageData(
            0,
            0,
            MODEL_SIZE,
            MODEL_SIZE
        );

    const pixels =
        imageData.data;

    const channelSize =
        MODEL_SIZE * MODEL_SIZE;

    const input =
        new Float32Array(
            3 * channelSize
        );

    for (
        let i = 0;
        i < channelSize;
        i++
    ) {

        input[i] =
            pixels[i * 4] / 255;

        input[channelSize + i] =
            pixels[i * 4 + 1] / 255;

        input[channelSize * 2 + i] =
            pixels[i * 4 + 2] / 255;
    }

    return new ort.Tensor(
        "float32",
        input,
        [1, 3, MODEL_SIZE, MODEL_SIZE]
    );
}


export interface Detection {

    x: number;
    y: number;

    width: number;
    height: number;

    confidence: number;

    classId: number;

    className: string;
}

function calculateIoU(
    a: Detection,
    b: Detection
): number {

    const x1 =
        Math.max(a.x, b.x);

    const y1 =
        Math.max(a.y, b.y);

    const x2 =
        Math.min(
            a.x + a.width,
            b.x + b.width
        );

    const y2 =
        Math.min(
            a.y + a.height,
            b.y + b.height
        );

    const intersectionWidth =
        Math.max(0, x2 - x1);

    const intersectionHeight =
        Math.max(0, y2 - y1);

    const intersection =
        intersectionWidth *
        intersectionHeight;

    const areaA =
        a.width * a.height;

    const areaB =
        b.width * b.height;

    const union =
        areaA +
        areaB -
        intersection;

    return intersection / union;
}

function applyNMS(
    detections: Detection[],
    iouThreshold: number = 0.45
): Detection[] {

    const sorted =
        [...detections].sort(
            (a, b) =>
                b.confidence -
                a.confidence
        );

    const selected: Detection[] = [];

    while (sorted.length > 0) {

        const best =
            sorted.shift();

        if (!best) {
            break;
        }

        selected.push(best);

        for (
            let i = sorted.length - 1;
            i >= 0;
            i--
        ) {

            const current =
                sorted[i];

            /*
             * Only suppress boxes
             * belonging to the same class.
             */

            if (
                current.classId ===
                best.classId
            ) {

                const iou =
                    calculateIoU(
                        best,
                        current
                    );

                if (
                    iou >
                    iouThreshold
                ) {

                    sorted.splice(
                        i,
                        1
                    );

                }

            }

        }

    }

    return selected;
}


/*
 * Convert YOLO output into detections
 */
function processOutput(
    output: ort.Tensor
): Detection[] {

    const data =
        output.data as Float32Array;

    const dimensions =
        output.dims;

    console.log(
        "Output dimensions:",
        dimensions
    );

    const detections: Detection[] = [];

    /*
     * YOLOv8 output is usually:
     *
     * [1, 84, 8400]
     *
     * 84 =
     * 4 box values + 80 classes
     */

    const numClasses =
        dimensions[1] - 4;

    const numPredictions =
        dimensions[2];

    for (
        let i = 0;
        i < numPredictions;
        i++
    ) {

        let bestScore = 0;
        let bestClass = 0;

        /*
         * Find class with highest confidence
         */

        for (
            let c = 0;
            c < numClasses;
            c++
        ) {

            const score =
                data[
                (4 + c) *
                numPredictions +
                i
                ];

            if (score > bestScore) {

                bestScore = score;

                bestClass = c;
            }
        }

        if (
            bestScore <
            CONFIDENCE_THRESHOLD
        ) {
            continue;
        }

        /*
         * YOLO gives:
         *
         * centerX
         * centerY
         * width
         * height
         */

        const centerX =
            data[i];

        const centerY =
            data[
            numPredictions + i
            ];

        const width =
            data[
            2 * numPredictions + i
            ];

        const height =
            data[
            3 * numPredictions + i
            ];

        detections.push({

            x: centerX - width / 2,

            y: centerY - height / 2,

            width,

            height,

            confidence: bestScore,

            classId: bestClass,

            className:
                CLASS_NAMES[bestClass] ??
                `class-${bestClass}`

        });
    }

    return applyNMS(
        detections,
        0.45
    );
}


export async function detect(
    imageSrc: string
): Promise<Detection[]> {

    const model =
        await loadModel();

    const input =
        await imageToTensor(
            imageSrc
        );

    const inputName =
        model.inputNames[0];

    const results =
        await model.run({

            [inputName]: input

        });

    const output =
        results[
        model.outputNames[0]
        ];

    if (!output) {

        throw new Error(
            "Model output not found"
        );
    }

    const detections =
        processOutput(
            output as ort.Tensor
        );

    console.log(
        "Detections:",
        detections
    );

    return detections;
}