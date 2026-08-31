chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "detectFormElements") {
    const formElements: string[] = [];

    const inputs = document.querySelectorAll("input, textarea, select");
    inputs.forEach((el) => {
      const input = el as HTMLInputElement;
      const type = input.type || "";
      const name = (input.name || "").toLowerCase();
      const placeholder = (input.placeholder || "").toLowerCase();
      const label = input.getAttribute("aria-label") || "";
      const combined = `${type} ${name} ${placeholder} ${label}`.toLowerCase();

      if (type === "password" || combined.includes("password")) {
        formElements.push("password_field");
      } else if (
        type === "email" ||
        combined.includes("email") ||
        combined.includes("e-mail")
      ) {
        formElements.push("email_field");
      } else if (
        type === "tel" ||
        combined.includes("phone") ||
        combined.includes("mobile")
      ) {
        formElements.push("phone_field");
      } else if (
        combined.includes("card") ||
        combined.includes("credit") ||
        combined.includes("payment")
      ) {
        formElements.push("credit_card_field");
      } else if (
        combined.includes("name") ||
        combined.includes("username")
      ) {
        formElements.push("name_field");
      } else if (
        combined.includes("address") ||
        combined.includes("street")
      ) {
        formElements.push("address_field");
      }
    });

    const buttons = document.querySelectorAll("button, input[type='submit']");
    buttons.forEach((el) => {
      const text = (el.textContent || "").toLowerCase();
      const value = (
        (el as HTMLInputElement).value || ""
      ).toLowerCase();
      const combined = `${text} ${value}`;

      if (
        combined.includes("login") ||
        combined.includes("sign in")
      ) {
        formElements.push("login_button");
      } else if (
        combined.includes("submit") ||
        combined.includes("save") ||
        combined.includes("send")
      ) {
        formElements.push("submit_button");
      }
    });

    sendResponse({
      success: true,
      elements: [...new Set(formElements)],
    });
    return true;
  }

  return false;
});
