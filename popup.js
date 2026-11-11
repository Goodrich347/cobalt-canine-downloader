const DEFAULT_SETTINGS = {
  defaultMode: "auto",
  reuseTab: true,
  silentBackground: true,
  autoCloseHelper: false,
  copyTriggerEnabled: true
};

const urlInput = document.getElementById("url-input");
const pasteBtn = document.getElementById("paste-btn");
const floatBtn = document.getElementById("float-btn");
const goBtn = document.getElementById("go-btn");
const statusBox = document.getElementById("status-box");
const downloadsSec = document.getElementById("downloads-sec");
const dlList = document.getElementById("dl-list");
const modeButtons = [...document.querySelectorAll(".mode-btn")];
const prefSilent = document.getElementById("pref-silent");
const prefCopyIcon = document.getElementById("pref-copy-icon");
const prefReuse = document.getElementById("pref-reuse");
const prefAutoClose = document.getElementById("pref-autoclose");

let selectedMode = "auto";
let activeJobKey = "";
let selectedIndices = new Set();

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setModeUI(mode) {
  selectedMode = mode;
  for (const btn of modeButtons) {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  }
}

async function saveSettings(patch) {
  const { settings } = await chrome.storage.local.get("settings");
  const next = { ...DEFAULT_SETTINGS, ...(settings || {}), ...patch };
  await chrome.storage.local.set({ settings: next });
}

function renderStatus(jobState) {
  if (!jobState || !jobState.status || Date.now() - (jobState.updatedAt || Date.now()) > 180000) {
    statusBox.className = "status-box";
    statusBox.replaceChildren();
    return;
  }

  const tone =
    jobState.status === "error" ? "err" :
    jobState.status === "done" ? "ok" :
    jobState.status === "turnstile_needs_human" ? "warn" : "";

  statusBox.className = `status-box visible ${tone}`.trim();
  statusBox.replaceChildren();

  const msg = document.createElement("div");
  msg.textContent = jobState.message || jobState.status;
  statusBox.appendChild(msg);

  if (jobState.status === "turnstile_needs_human") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "turnstile-btn";
    btn.textContent = "Verify Cloudflare (open mini window)";
    btn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "OPEN_TURNSTILE_HELPER" }).catch(() => {});
    });
    statusBox.appendChild(btn);
  }

  if (jobState.status === "picker" && Array.isArray(jobState.pickerItems) && jobState.pickerItems.length) {
    const jobKey = `${jobState.jobId || ""}:${jobState.pickerItems.length}`;
    if (jobKey !== activeJobKey) {
      activeJobKey = jobKey;
      selectedIndices = new Set(jobState.pickerItems.map((it) => it.index));
    }

    const toolbar = document.createElement("div");
    toolbar.className = "picker-toolbar";
    const countEl = document.createElement("span");
    countEl.className = "picker-count";

    const tools = document.createElement("div");
    tools.className = "picker-tools";
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "mini-action";
    allBtn.textContent = "Select all";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "mini-action";
    clearBtn.textContent = "Clear";
    tools.append(allBtn, clearBtn);
    toolbar.append(countEl, tools);

    const grid = document.createElement("div");
    grid.className = "picker-grid";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "save-batch-btn";

    const cardNodes = [];
    function syncPickerUI() {
      countEl.textContent = `${selectedIndices.size} / ${jobState.pickerItems.length} selected`;
      saveBtn.textContent = `Save selected (${selectedIndices.size})`;
      saveBtn.disabled = selectedIndices.size === 0;
      cardNodes.forEach(({ card, idx }) => {
        card.classList.toggle("selected", selectedIndices.has(idx));
      });
    }

    jobState.pickerItems.forEach((item) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "picker-item";

      const check = document.createElement("span");
      check.className = "picker-check";
      check.textContent = "✓";
      card.appendChild(check);

      if (item.thumb) {
        const img = document.createElement("img");
        img.src = item.thumb;
        card.appendChild(img);
      } else {
        const fb = document.createElement("div");
        fb.className = "picker-fallback";
        fb.textContent = (item.type || "FILE").toUpperCase();
        card.appendChild(fb);
      }

      const lbl = document.createElement("span");
      lbl.textContent = item.label || `#${item.index + 1}`;
      card.appendChild(lbl);

      card.addEventListener("click", () => {
        if (selectedIndices.has(item.index)) selectedIndices.delete(item.index);
        else selectedIndices.add(item.index);
        syncPickerUI();
      });

      cardNodes.push({ card, idx: item.index });
      grid.appendChild(card);
    });

    allBtn.addEventListener("click", () => {
      selectedIndices = new Set(jobState.pickerItems.map((it) => it.index));
      syncPickerUI();
    });

    clearBtn.addEventListener("click", () => {
      selectedIndices.clear();
      syncPickerUI();
    });

    saveBtn.addEventListener("click", async () => {
      const chosen = jobState.pickerItems.filter((it) => selectedIndices.has(it.index));
      const withUrls = chosen.filter((it) => it.url);
      saveBtn.disabled = true;
      saveBtn.textContent = `Saving ${chosen.length}...`;

      if (withUrls.length > 0) {
        await chrome.runtime.sendMessage({ type: "DOWNLOAD_BATCH", items: withUrls }).catch(() => {});
      } else {
        for (const it of chosen) {
          await chrome.runtime.sendMessage({ type: "CLICK_PICKER_ITEM", index: it.index }).catch(() => {});
        }
      }
      saveBtn.disabled = false;
      syncPickerUI();
    });

    syncPickerUI();
    statusBox.append(toolbar, grid, saveBtn);
  }
}

function renderDownloads(items) {
  if (!Array.isArray(items) || !items.length) {
    downloadsSec.classList.remove("visible");
    dlList.replaceChildren();
    return;
  }

  downloadsSec.classList.add("visible");
  dlList.replaceChildren();

  items.slice(0, 5).forEach((item) => {
    const card = document.createElement("div");
    card.className = "dl-item";

    const top = document.createElement("div");
    top.className = "dl-top";

    const name = document.createElement("span");
    name.className = "dl-name";
    name.textContent = item.filename;
    name.title = item.filename;

    const meta = document.createElement("span");
    meta.className = "dl-meta";
    if (item.state === "complete") {
      meta.textContent = formatBytes(item.totalBytes || item.bytesReceived) || "Done";
    } else if (item.state === "interrupted") {
      meta.textContent = "Failed";
    } else {
      meta.textContent = item.pct != null ? `${item.pct}%` : formatBytes(item.bytesReceived) || "...";
    }

    top.append(name, meta);
    card.appendChild(top);

    if (item.state === "in_progress") {
      const wrap = document.createElement("div");
      wrap.className = "dl-bar-wrap";
      const bar = document.createElement("div");
      bar.className = "dl-bar";
      bar.style.width = `${item.pct ?? 35}%`;
      wrap.appendChild(bar);
      card.appendChild(wrap);
    }

    if (item.state === "complete") {
      const actions = document.createElement("div");
      actions.className = "dl-actions";
      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "dl-btn";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "OPEN_DOWNLOAD", id: item.id }).catch(() => {});
      });

      const showBtn = document.createElement("button");
      showBtn.type = "button";
      showBtn.className = "dl-btn";
      showBtn.textContent = "Finder";
      showBtn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "SHOW_DOWNLOAD", id: item.id }).catch(() => {});
      });
      actions.append(openBtn, showBtn);
      card.appendChild(actions);
    }

    dlList.appendChild(card);
  });
}

async function readClipboardSafely() {
  try {
    const txt = await navigator.clipboard.readText();
    if (txt) return txt.trim();
  } catch {
    try {
      const prev = urlInput.value;
      urlInput.value = "";
      urlInput.focus();
      const ok = document.execCommand("paste");
      if (ok && urlInput.value) return urlInput.value.trim();
      urlInput.value = prev;
    } catch {}
  }
  const off = await chrome.runtime.sendMessage({ type: "READ_CLIPBOARD" }).catch(() => null);
  return off?.ok && off.text ? off.text.trim() : "";
}

async function init() {
  const { settings, jobState, recentDownloads } = await chrome.storage.local.get([
    "settings",
    "jobState",
    "recentDownloads"
  ]);
  const cfg = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  setModeUI(cfg.defaultMode);
  prefSilent.checked = Boolean(cfg.silentBackground);
  prefCopyIcon.checked = cfg.copyTriggerEnabled !== false;
  prefReuse.checked = Boolean(cfg.reuseTab);
  prefAutoClose.checked = Boolean(cfg.autoCloseHelper);

  if (jobState) renderStatus(jobState);
  if (recentDownloads) renderDownloads(recentDownloads);

  const clip = await readClipboardSafely();
  if (/^https?:\/\//i.test(clip) && !clip.startsWith("https://cobalt.canine.tools")) {
    urlInput.value = clip;
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && /^https?:\/\//i.test(tab.url) && !tab.url.startsWith("https://cobalt.canine.tools")) {
    urlInput.value = tab.url;
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.jobState?.newValue) renderStatus(changes.jobState.newValue);
  if (changes.recentDownloads?.newValue) renderDownloads(changes.recentDownloads.newValue);
});

modeButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const mode = btn.dataset.mode;
    setModeUI(mode);
    await saveSettings({ defaultMode: mode });
  });
});

prefSilent.addEventListener("change", () => saveSettings({ silentBackground: prefSilent.checked }));
prefCopyIcon.addEventListener("change", () => saveSettings({ copyTriggerEnabled: prefCopyIcon.checked }));
prefReuse.addEventListener("change", () => saveSettings({ reuseTab: prefReuse.checked }));
prefAutoClose.addEventListener("change", () => saveSettings({ autoCloseHelper: prefAutoClose.checked }));

pasteBtn.addEventListener("click", async () => {
  const txt = await readClipboardSafely();
  if (txt) {
    urlInput.value = txt;
    renderStatus(null);
  } else {
    renderStatus({
      status: "error",
      message: "Clipboard is empty — paste manually with Cmd+V.",
      updatedAt: Date.now()
    });
  }
});

floatBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await chrome.tabs.sendMessage(tab.id, {
      type: "OPEN_MINI_WIDGET",
      url: urlInput.value.trim() || tab.url || ""
    }).catch(() => {});
    window.close();
  }
});

async function submit() {
  const raw = urlInput.value.trim();
  if (!raw) {
    renderStatus({ status: "error", message: "Enter or paste a link first.", updatedAt: Date.now() });
    urlInput.focus();
    return;
  }

  goBtn.disabled = true;
  renderStatus({ status: "queued", message: "Sending to Cobalt...", updatedAt: Date.now() });

  const res = await chrome.runtime.sendMessage({
    type: "ENQUEUE_DOWNLOAD",
    url: raw,
    mode: selectedMode
  }).catch(() => ({ ok: false, error: "Could not reach extension background." }));

  goBtn.disabled = false;
  if (!res?.ok) {
    renderStatus({ status: "error", message: res?.error || "Failed to send URL.", updatedAt: Date.now() });
  }
}

goBtn.addEventListener("click", submit);
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submit();
});

init();
