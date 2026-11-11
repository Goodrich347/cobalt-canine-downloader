(() => {
  const JOB_TTL_MS = 120000;
  const TURNSTILE_SOFT_WAIT_MS = 9000;
  const TURNSTILE_HARD_WAIT_MS = 60000;
  const ELEMENT_TIMEOUT_MS = 15000;

  const processedIds = new Set();
  let isRunning = false;
  let lastTapPayload = null;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.source === "cobalt-canine-tap" && event.data.payload) {
      lastTapPayload = {
        data: event.data.payload,
        ts: Date.now()
      };
    }
  });

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function reportStatus(jobId, status, message, extra = {}) {
    chrome.runtime.sendMessage({
      type: "COBALT_BRIDGE_STATUS",
      jobId,
      status,
      message,
      ...extra
    }).catch(() => {});
  }

  function showToast(text, tone = "info") {
    let el = document.getElementById("cobalt-ext-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "cobalt-ext-toast";
      Object.assign(el.style, {
        position: "fixed",
        top: "14px",
        right: "14px",
        zIndex: "2147483647",
        padding: "8px 14px",
        borderRadius: "10px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "13px",
        fontWeight: "600",
        boxShadow: "0 8px 24px rgba(0,0,0,0.32)",
        transition: "opacity 0.2s ease",
        pointerEvents: "none",
        maxWidth: "320px"
      });
      document.documentElement.appendChild(el);
    }
    const palette = {
      info: { bg: "#14161c", fg: "#f4f4f5", border: "1px solid #2e3340" },
      ok: { bg: "#0f291e", fg: "#6ee7b7", border: "1px solid #10b981" },
      warn: { bg: "#2b200d", fg: "#fcd34d", border: "1px solid #f59e0b" },
      err: { bg: "#2d1215", fg: "#fca5a5", border: "1px solid #ef4444" }
    }[tone] || { bg: "#14161c", fg: "#f4f4f5", border: "1px solid #2e3340" };

    el.style.background = palette.bg;
    el.style.color = palette.fg;
    el.style.border = palette.border;
    el.style.opacity = "1";
    el.textContent = text;
  }

  async function waitForElements() {
    const start = Date.now();
    while (Date.now() - start < ELEMENT_TIMEOUT_MS) {
      const input = document.getElementById("link-area");
      const btn = document.getElementById("download-button");
      if (input && btn) return { input, btn };
      await sleep(150);
    }
    return null;
  }

  function dismissOpenDialogs() {
    const dialogs = document.querySelectorAll(".dialog-body");
    if (!dialogs.length) return;
    const closeBtn = document.querySelector(".dialog-body button");
    if (closeBtn) closeBtn.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  function isTurnstileBlocking() {
    const input = document.getElementById("link-area");
    const aria = (input?.getAttribute("aria-label") || "").toLowerCase();
    const cfInput = document.querySelector('input[name="cf-turnstile-response"]');
    const hasToken = Boolean(cfInput && cfInput.value && cfInput.value.trim().length > 0);
    if (hasToken) return false;
    if (aria.includes("robot") || aria.includes("turnstile")) return true;
    const text = (document.body?.innerText || "").toLowerCase();
    return text.includes("checking if you're not a bot");
  }

  async function waitForTurnstileReady(jobId) {
    if (!isTurnstileBlocking()) return true;
    reportStatus(jobId, "waiting_turnstile", "Waiting for Cloudflare Turnstile...");
    showToast("Cobalt Ext: waiting for Cloudflare Turnstile...", "warn");

    const start = Date.now();
    let flaggedNeedsHuman = false;
    while (Date.now() - start < TURNSTILE_HARD_WAIT_MS) {
      if (!isTurnstileBlocking()) return true;
      if (!flaggedNeedsHuman && Date.now() - start > TURNSTILE_SOFT_WAIT_MS) {
        flaggedNeedsHuman = true;
        reportStatus(jobId, "turnstile_needs_human", "Cloudflare verification requires your click.");
      }
      await sleep(300);
    }
    return false;
  }

  function setNativeInputValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    );
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function selectMode(mode) {
    if (!["auto", "audio", "mute"].includes(mode)) return;
    const btn = document.getElementById(`setting-button-save-downloadMode-${mode}`);
    if (btn && !btn.classList.contains("active")) {
      btn.click();
      await sleep(120);
    }
  }

  function extractPickerItems() {
    const tapData = lastTapPayload && Date.now() - lastTapPayload.ts < 30000
      ? lastTapPayload.data
      : null;

    if (tapData?.status === "picker" && Array.isArray(tapData.picker) && tapData.picker.length) {
      const items = tapData.picker.map((entry, index) => ({
        index,
        type: entry.type || "media",
        url: entry.url || "",
        thumb: entry.thumb || entry.url || "",
        label: `${(entry.type || "file").toUpperCase()} #${index + 1}`
      }));
      if (tapData.audio) {
        items.push({
          index: items.length,
          type: "audio",
          url: tapData.audio,
          thumb: "",
          label: "Audio Track"
        });
      }
      return items;
    }

    const buttons = [...document.querySelectorAll(".picker-dialog .picker-item")];
    return buttons.map((btn, index) => {
      const img = btn.querySelector("img");
      return {
        index,
        type: "media",
        url: "",
        thumb: img?.getAttribute("src") || "",
        label: img?.getAttribute("alt") || `Item #${index + 1}`
      };
    });
  }

  // Also inject a convenient multi-select bar directly inside Cobalt's native picker dialog if user opens the page
  function enhanceNativePickerDialog() {
    const dialog = document.querySelector(".dialog-body.picker-dialog");
    if (!dialog || dialog.querySelector("#cobalt-ext-native-batch")) return;

    const items = extractPickerItems();
    const downloadable = items.filter((it) => it.url);
    if (!downloadable.length) return;

    const bar = document.createElement("div");
    bar.id = "cobalt-ext-native-batch";
    Object.assign(bar.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: "8px",
      margin: "8px 0 6px",
      padding: "8px 10px",
      borderRadius: "10px",
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(56,189,248,0.4)",
      fontSize: "12px"
    });

    const selected = new Set(downloadable.map((it) => it.index));
    const domButtons = [...dialog.querySelectorAll(".picker-item")];

    const info = document.createElement("span");
    const saveBtn = document.createElement("button");
    const toggleBtn = document.createElement("button");

    function syncVisual() {
      info.textContent = `${selected.size} / ${downloadable.length} selected`;
      saveBtn.textContent = `Save selected (${selected.size})`;
      saveBtn.disabled = selected.size === 0;
      domButtons.forEach((btn, idx) => {
        btn.style.outline = selected.has(idx) ? "2px solid #38bdf8" : "none";
        btn.style.opacity = selected.has(idx) ? "1" : "0.55";
      });
    }

    toggleBtn.type = "button";
    toggleBtn.textContent = "Toggle all";
    Object.assign(toggleBtn.style, {
      padding: "5px 9px",
      borderRadius: "7px",
      border: "1px solid rgba(255,255,255,0.2)",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      fontSize: "11.5px"
    });
    toggleBtn.addEventListener("click", () => {
      if (selected.size === downloadable.length) selected.clear();
      else downloadable.forEach((it) => selected.add(it.index));
      syncVisual();
    });

    saveBtn.type = "button";
    Object.assign(saveBtn.style, {
      padding: "6px 12px",
      borderRadius: "7px",
      border: "none",
      background: "#38bdf8",
      color: "#06131c",
      fontWeight: "700",
      cursor: "pointer",
      fontSize: "12px"
    });
    saveBtn.addEventListener("click", () => {
      const chosen = downloadable.filter((it) => selected.has(it.index));
      chrome.runtime.sendMessage({ type: "DOWNLOAD_BATCH", items: chosen }).catch(() => {});
    });

    domButtons.forEach((btn, idx) => {
      const badge = document.createElement("input");
      badge.type = "checkbox";
      badge.checked = true;
      Object.assign(badge.style, {
        position: "absolute",
        top: "6px",
        right: "6px",
        width: "16px",
        height: "16px",
        accentColor: "#38bdf8",
        zIndex: "5"
      });
      btn.style.position = "relative";
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        if (badge.checked) selected.add(idx);
        else selected.delete(idx);
        syncVisual();
      });
      btn.appendChild(badge);
    });

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "6px";
    right.append(toggleBtn, saveBtn);
    bar.append(info, right);

    const pickerBody = dialog.querySelector(".picker-body");
    if (pickerBody) dialog.insertBefore(bar, pickerBody);
    else dialog.appendChild(bar);
    syncVisual();
  }

  const pickerObserver = new MutationObserver(() => {
    if (document.querySelector(".dialog-body.picker-dialog")) {
      enhanceNativePickerDialog();
    }
  });
  pickerObserver.observe(document.documentElement, { childList: true, subtree: true });

  async function observeDownloadOutcome(jobId) {
    const start = Date.now();
    while (Date.now() - start < 35000) {
      const stateEl = document.getElementById("download-state");
      const text = (stateEl?.textContent || "").trim();

      const errorDialog = document.querySelector(".dialog-body.small-dialog");
      if (text === "!!" || errorDialog) {
        const errText =
          errorDialog?.querySelector(".body-text")?.textContent?.trim() ||
          "Cobalt returned an error.";
        showToast(`Cobalt Ext: ${errText}`, "err");
        reportStatus(jobId, "error", errText);
        return;
      }

      const pickerDialog = document.querySelector(".dialog-body.picker-dialog");
      if (pickerDialog) {
        await sleep(120);
        const items = extractPickerItems();
        enhanceNativePickerDialog();
        showToast("Cobalt Ext: select items to save.", "ok");
        reportStatus(jobId, "picker", `Found ${items.length} items — select what to save:`, {
          pickerItems: items
        });
        return;
      }

      if (text === ">>>") {
        await sleep(400);
        const latePicker = document.querySelector(".dialog-body.picker-dialog");
        if (latePicker) {
          const items = extractPickerItems();
          enhanceNativePickerDialog();
          showToast("Cobalt Ext: select items to save.", "ok");
          reportStatus(jobId, "picker", `Found ${items.length} items — select what to save:`, {
            pickerItems: items
          });
          return;
        }
        showToast("Cobalt Ext: download started!", "ok");
        reportStatus(jobId, "done", "Download started!");
        return;
      }

      await sleep(250);
    }
    reportStatus(jobId, "error", "Timed out waiting for Cobalt response.");
  }

  async function runJob(job) {
    if (!job || !job.id || !job.url) return;
    if (processedIds.has(job.id)) return;
    if (Date.now() - (job.createdAt || 0) > JOB_TTL_MS) return;

    while (isRunning) {
      await sleep(200);
    }

    isRunning = true;
    processedIds.add(job.id);
    lastTapPayload = null;
    await chrome.storage.local.remove("pendingJob").catch(() => {});

    try {
      reportStatus(job.id, "preparing", "Preparing Cobalt...");
      showToast("Cobalt Ext: preparing page...", "info");
      const els = await waitForElements();
      if (!els) {
        showToast("Cobalt Ext: page UI not found.", "err");
        reportStatus(job.id, "error", "Cobalt page UI failed to load.");
        return;
      }

      dismissOpenDialogs();
      await sleep(100);
      await selectMode(job.mode || "auto");

      els.input.focus();
      setNativeInputValue(els.input, job.url);
      await sleep(120);

      const turnstileOk = await waitForTurnstileReady(job.id);
      if (!turnstileOk) {
        showToast("Cobalt Ext: complete Turnstile check, then click >>", "warn");
        reportStatus(job.id, "turnstile_needs_human", "Cloudflare verification requires your click.");
        return;
      }

      const waitBtnStart = Date.now();
      while (els.btn.disabled && Date.now() - waitBtnStart < 5000) {
        await sleep(150);
      }

      reportStatus(job.id, "processing", "Fetching download links...");
      showToast(`Cobalt Ext: downloading (${job.mode || "auto"})...`, "info");
      els.btn.click();
      await observeDownloadOutcome(job.id);
    } finally {
      isRunning = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "RUN_COBALT_JOB" && message.job) {
      runJob(message.job);
      sendResponse({ accepted: true });
      return true;
    }
    if (message?.type === "COBALT_CLICK_PICKER") {
      const btns = [...document.querySelectorAll(".picker-dialog .picker-item")];
      const target = btns[message.index];
      if (target) {
        target.click();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
      return true;
    }
    return false;
  });

  chrome.storage.local.get("pendingJob").then(({ pendingJob }) => {
    if (pendingJob) {
      runJob(pendingJob);
    }
  }).catch(() => {});
})();
