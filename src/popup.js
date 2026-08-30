const captureBtn = document.getElementById("captureBtn");
const preview = document.getElementById("preview");
const status = document.getElementById("status");

captureBtn.addEventListener("click", async () => {

    const canvas =
        document.getElementById("canvas");

    const ctx =
        canvas.getContext("2d");

    status.innerText = "Capturing...";

    try {

        const image = await chrome.tabs.captureVisibleTab(
            null,
            {
                format: "png"
            }
        );

        preview.src = image;

        status.innerText = "Screenshot captured successfully!";

    } catch (error) {

        console.error(error);

        status.innerText = "Capture failed.";

    }

    const image = new Image();

    image.src = screenshot;

    image.onload = () => {

        canvas.width = image.width;
        canvas.height = image.height;

        ctx.drawImage(
            image,
            0,
            0
        );
    };
    function drawBox(box) {

        ctx.strokeStyle = "red";
        ctx.lineWidth = 3;

        ctx.strokeRect(
            box.x,
            box.y,
            box.width,
            box.height
        );
    }
});