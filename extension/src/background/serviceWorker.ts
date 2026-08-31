chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "capture") {
    chrome.tabs.captureVisibleTab(
      undefined as unknown as number,
      { format: "png" },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        sendResponse({ success: true, image: dataUrl });
      }
    );
    return true;
  }

  if (message.action === "getTabInfo") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError || !tabs[0]) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError?.message || "No active tab",
        });
        return;
      }
      const tab = tabs[0];
      let hostname = "";
      try {
        hostname = new URL(tab.url || "").hostname;
      } catch {
        hostname = tab.url || "unknown";
      }
      sendResponse({
        success: true,
        tabId: tab.id,
        url: tab.url,
        hostname,
        title: tab.title,
      });
    });
    return true;
  }

  return false;
});
