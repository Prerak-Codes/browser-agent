import * as ort from "onnxruntime-web";

let session: ort.InferenceSession | null = null;

const MODEL_SIZE = 640;

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

    await image.decode();

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
            pixels[i * 4] / 255.0;

        input[channelSize + i] =
            pixels[i * 4 + 1] / 255.0;

        input[channelSize * 2 + i] =
            pixels[i * 4 + 2] / 255.0;
    }

    return new ort.Tensor(
        "float32",
        input,
        [1, 3, MODEL_SIZE, MODEL_SIZE]
    );
}


export async function detect(
    imageSrc: string
): Promise<ort.InferenceSession.OnnxValueMapType> {

    const model =
        await loadModel();

    const input =
        await imageToTensor(imageSrc);

    const inputName =
        model.inputNames[0];

    const output =
        await model.run({
            [inputName]: input
        });

    return output;
}