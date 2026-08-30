chrome.runtime.onMessage.addListener(
    (message, sender, sendResponse) => {

        if (message.action === "capture") {

            const canvas = document.createElement("canvas");

            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;

            const ctx = canvas.getContext("2d");

            ctx.fillStyle = "white";
            ctx.fillRect(
                0,
                0,
                canvas.width,
                canvas.height
            );

            ctx.fillStyle = "black";
            ctx.font = "30px Arial";

            ctx.fillText(
                "Screen Capture Prototype",
                50,
                100
            );

            const image = canvas.toDataURL("image/png");

            sendResponse({
                success: true,
                image: image
            });

        }

        return true;
    }
);