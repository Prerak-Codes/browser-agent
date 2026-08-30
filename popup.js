const captureBtn = document.getElementById("captureBtn");
const preview = document.getElementById("preview");
const status = document.getElementById("status");

captureBtn.addEventListener("click", async () => {

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

});