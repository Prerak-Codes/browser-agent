import {
    loadModel,
    detect
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

            const result =
                await detect(
                    "/test.jpg"
                );

            console.log(
                "Detection result:",
                result
            );

            status.innerText =
                "Detection completed. Check console.";

        } catch (error) {

            console.error(error);

            status.innerText =
                "Detection failed.";

        }

    }
);