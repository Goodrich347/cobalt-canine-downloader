chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen" || message?.type !== "READ_CLIPBOARD") {
    return false;
  }

  (async () => {
    try {
      const text = await navigator.clipboard.readText();
      sendResponse({ ok: true, text });
    } catch {
      try {
        const trap = document.getElementById("paste-trap");
        trap.value = "";
        trap.focus();
        document.execCommand("paste");
        sendResponse({ ok: true, text: trap.value || "" });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || "Clipboard read failed" });
      }
    }
  })();

  return true;
});
