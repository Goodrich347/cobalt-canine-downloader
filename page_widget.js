(() => {
  if (window.__cobaltCanineWidgetMounted) return;
  window.__cobaltCanineWidgetMounted = true;

  const URL_RE = /https?:\/\/[^\s<>"'`]+/i;
  let host = null;
  let shadow = null;
  let pillEl = null;
  let panelEl = null;
  let currentMode = "auto";
  let currentUrl = "";
  let hidePillTimer = null;
  let selectionTimer = null;
  let copyTriggerEnabled = true;
  let lastPointer = { x: window.innerWidth - 120, y: 120 };
  let pendingContextLink = null;
  let clipboardCheckPending = false;
  let activeJobKey = "";
  let selectedIndices = new Set();

  function extractUrl(text) {
    if (!text || typeof text !== "string") return null;
    const m = text.trim().match(URL_RE);
    if (!m) return null;
    try {
      const u = new URL(m[0]);
      if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname !== "cobalt.canine.tools") {
        return u.toString();
      }
    } catch {
      return null;
    }
    return null;
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "";
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function ensureShadow() {
    if (shadow) return;
    host = document.createElement("div");
    host.id = "cobalt-canine-floating-host";
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "2147483646"
    });
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      * { box-sizing: border-box; font-family: "Space Grotesk", system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }
      .pill {
        position: fixed;
        pointer-events: auto;
        display: none;
        align-items: center;
        gap: 7px;
        padding: 6px 11px;
        border-radius: 999px;
        background: rgba(13, 15, 20, 0.94);
        backdrop-filter: blur(10px);
        color: #f4f4f5;
        border: 1px solid rgba(56, 189, 248, 0.55);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255,255,255,0.04);
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        user-select: none;
        transition: transform 0.14s ease, border-color 0.14s ease;
      }
      .pill:hover { transform: translateY(-1px) scale(1.02); border-color: #38bdf8; }
      .pill-badge {
        display: inline-grid;
        place-items: center;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        background: #38bdf8;
        color: #06131c;
        font-size: 10px;
        font-weight: 800;
      }
      .pill-close {
        margin-left: 2px;
        opacity: 0.65;
        font-size: 12px;
        padding: 0 3px;
      }
      .pill-close:hover { opacity: 1; }

      .panel {
        position: fixed;
        right: 18px;
        bottom: 18px;
        width: 364px;
        max-height: 84vh;
        overflow-y: auto;
        pointer-events: auto;
        display: none;
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        border-radius: 14px;
        background: rgba(12, 13, 17, 0.96);
        backdrop-filter: blur(16px);
        color: #f3f4f6;
        border: 1px solid #262a34;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.58);
        font-size: 12.5px;
        direction: ltr;
        text-align: left;
      }
      .panel.open { display: flex; }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: grab;
        user-select: none;
      }
      .brand { display: flex; align-items: center; gap: 8px; }
      .brand-mark {
        width: 26px; height: 26px; border-radius: 7px;
        display: grid; place-items: center;
        background: #15181e; border: 1px solid #38bdf8;
        color: #38bdf8; font-weight: 800; font-size: 11px;
      }
      .brand-title { font-size: 13px; font-weight: 700; }
      .brand-sub { font-size: 10.5px; color: #9ca3af; }
      .header-actions { display: flex; align-items: center; gap: 6px; }
      .icon-btn {
        background: #171a22; color: #cbd5e1; border: 1px solid #262a34;
        border-radius: 7px; padding: 4px 8px; font-size: 11px; cursor: pointer;
      }
      .icon-btn:hover { border-color: #38bdf8; color: #fff; }
      .url-row { display: flex; gap: 6px; }
      .url-input {
        flex: 1; min-width: 0; background: #15181e; color: #f3f4f6;
        border: 1px solid #262a34; border-radius: 8px; padding: 8px 10px;
        font-size: 12px; outline: none;
      }
      .url-input:focus { border-color: #38bdf8; }
      .modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .mode-btn {
        background: #15181e; color: #9ca3af; border: 1px solid #262a34;
        border-radius: 8px; padding: 6px; font-size: 11.5px; font-weight: 600; cursor: pointer;
      }
      .mode-btn.active {
        color: #f8fafc; border-color: #38bdf8; background: rgba(56, 189, 248, 0.14);
      }
      .go-btn {
        width: 100%; background: #38bdf8; color: #06131c; border: none;
        border-radius: 8px; padding: 8px 12px; font-size: 12.5px; font-weight: 700; cursor: pointer;
      }
      .go-btn:hover { filter: brightness(1.08); }
      .go-btn:disabled { opacity: 0.55; cursor: not-allowed; }

      .status-box {
        display: none;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border-radius: 9px;
        background: #15181e;
        border: 1px solid #262a34;
        font-size: 11.5px;
      }
      .status-box.visible { display: flex; }
      .status-box.err { border-color: rgba(239, 68, 68, 0.55); color: #fca5a5; }
      .status-box.ok { border-color: rgba(16, 185, 129, 0.55); color: #6ee7b7; }
      .status-box.warn { border-color: rgba(245, 158, 11, 0.55); color: #fcd34d; }

      .turnstile-btn {
        background: #f59e0b; color: #1a1100; border: none; border-radius: 7px;
        padding: 6px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer;
      }

      .picker-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
      }
      .picker-count {
        font-size: 11px;
        color: #cbd5e1;
        font-weight: 600;
      }
      .picker-tools {
        display: flex;
        gap: 5px;
      }
      .mini-action {
        background: #1c212c;
        color: #e2e8f0;
        border: 1px solid #2e3444;
        border-radius: 6px;
        padding: 3px 7px;
        font-size: 10.5px;
        cursor: pointer;
      }
      .mini-action:hover { border-color: #38bdf8; }

      .picker-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        max-height: 220px;
        overflow-y: auto;
      }
      .picker-item {
        position: relative;
        background: #0f1116;
        border: 1.5px solid #2a303c;
        border-radius: 8px;
        padding: 4px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        color: #cbd5e1;
        font-size: 10px;
        opacity: 0.65;
        transition: border-color 0.12s ease, opacity 0.12s ease;
      }
      .picker-item.selected {
        border-color: #38bdf8;
        background: rgba(56, 189, 248, 0.1);
        opacity: 1;
        color: #f8fafc;
      }
      .picker-check {
        position: absolute;
        top: 6px;
        right: 6px;
        width: 17px;
        height: 17px;
        border-radius: 5px;
        background: rgba(12, 13, 17, 0.85);
        border: 1.5px solid #64748b;
        display: grid;
        place-items: center;
        font-size: 11px;
        font-weight: 800;
        color: transparent;
      }
      .picker-item.selected .picker-check {
        background: #38bdf8;
        border-color: #38bdf8;
        color: #06131c;
      }
      .picker-item img {
        width: 100%;
        height: 58px;
        object-fit: cover;
        border-radius: 5px;
      }
      .picker-fallback {
        width: 100%;
        height: 58px;
        border-radius: 5px;
        display: grid;
        place-items: center;
        background: #171b24;
        color: #38bdf8;
        font-weight: 700;
        font-size: 11px;
      }
      .save-batch-btn {
        width: 100%;
        background: #10b981;
        color: #032016;
        border: none;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      .save-batch-btn:hover { filter: brightness(1.08); }
      .save-batch-btn:disabled { opacity: 0.45; cursor: not-allowed; }

      .downloads-sec {
        border-top: 1px solid #232732;
        padding-top: 8px;
        display: none;
        flex-direction: column;
        gap: 6px;
      }
      .downloads-sec.visible { display: flex; }
      .downloads-title { font-size: 11px; color: #9ca3af; }
      .dl-item {
        background: #15181e; border: 1px solid #262a34; border-radius: 8px;
        padding: 7px 9px; display: flex; flex-direction: column; gap: 5px;
      }
      .dl-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
      .dl-name {
        font-size: 11.5px; font-weight: 600; color: #f3f4f6;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 210px;
      }
      .dl-meta { font-size: 10.5px; color: #9ca3af; }
      .dl-bar-wrap {
        width: 100%; height: 4px; border-radius: 999px; background: #232732; overflow: hidden;
      }
      .dl-bar { height: 100%; background: #38bdf8; transition: width 0.25s ease; }
      .dl-actions { display: flex; gap: 6px; }
      .dl-btn {
        background: #1d222c; color: #e2e8f0; border: 1px solid #2e3444;
        border-radius: 6px; padding: 3px 8px; font-size: 10.5px; cursor: pointer;
      }
      .dl-btn:hover { border-color: #38bdf8; color: #fff; }
    `;

    pillEl = document.createElement("div");
    pillEl.className = "pill";
    const pillBadge = document.createElement("span");
    pillBadge.className = "pill-badge";
    pillBadge.textContent = ">>";
    const pillLabel = document.createElement("span");
    pillLabel.className = "pill-label";
    pillLabel.textContent = "Cobalt";
    const pillClose = document.createElement("span");
    pillClose.className = "pill-close";
    pillClose.title = "Dismiss";
    pillClose.textContent = "✕";
    pillEl.append(pillBadge, pillLabel, pillClose);

    panelEl = document.createElement("div");
    panelEl.className = "panel";

    const header = document.createElement("div");
    header.className = "header";
    header.id = "drag-handle";

    const brand = document.createElement("div");
    brand.className = "brand";
    const mark = document.createElement("span");
    mark.className = "brand-mark";
    mark.textContent = ">>";
    const titleWrap = document.createElement("div");
    const bTitle = document.createElement("div");
    bTitle.className = "brand-title";
    bTitle.textContent = "Cobalt Canine";
    const bSub = document.createElement("div");
    bSub.className = "brand-sub";
    bSub.textContent = "mini downloader";
    titleWrap.append(bTitle, bSub);
    brand.append(mark, titleWrap);

    const hActions = document.createElement("div");
    hActions.className = "header-actions";
    const openTabBtn = document.createElement("button");
    openTabBtn.className = "icon-btn";
    openTabBtn.id = "open-tab-btn";
    openTabBtn.type = "button";
    openTabBtn.textContent = "Site ↗";
    const closePanelBtn = document.createElement("button");
    closePanelBtn.className = "icon-btn";
    closePanelBtn.id = "close-panel-btn";
    closePanelBtn.type = "button";
    closePanelBtn.textContent = "✕";
    hActions.append(openTabBtn, closePanelBtn);
    header.append(brand, hActions);

    const urlRow = document.createElement("div");
    urlRow.className = "url-row";
    const urlInp = document.createElement("input");
    urlInp.className = "url-input";
    urlInp.id = "mini-url";
    urlInp.type = "url";
    urlInp.placeholder = "https://...";
    urlInp.spellcheck = false;
    urlInp.autocomplete = "off";
    const pasteBtn = document.createElement("button");
    pasteBtn.className = "icon-btn";
    pasteBtn.id = "mini-paste";
    pasteBtn.type = "button";
    pasteBtn.textContent = "Paste";
    urlRow.append(urlInp, pasteBtn);

    const modes = document.createElement("div");
    modes.className = "modes";
    [["auto", "Auto"], ["audio", "Audio"], ["mute", "Mute"]].forEach(([mode, label]) => {
      const b = document.createElement("button");
      b.className = `mode-btn${mode === "auto" ? " active" : ""}`;
      b.dataset.mode = mode;
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", () => setMode(mode));
      modes.appendChild(b);
    });

    const goBtn = document.createElement("button");
    goBtn.className = "go-btn";
    goBtn.id = "mini-go";
    goBtn.type = "button";
    goBtn.textContent = "Download";

    const statusBox = document.createElement("div");
    statusBox.className = "status-box";
    statusBox.id = "mini-status";

    const dlSec = document.createElement("div");
    dlSec.className = "downloads-sec";
    dlSec.id = "mini-downloads";
    const dlTitle = document.createElement("div");
    dlTitle.className = "downloads-title";
    dlTitle.textContent = "Recent downloads";
    const dlList = document.createElement("div");
    dlList.id = "mini-dl-list";
    dlSec.append(dlTitle, dlList);

    panelEl.append(header, urlRow, modes, goBtn, statusBox, dlSec);
    shadow.append(style, pillEl, panelEl);
    (document.body || document.documentElement).appendChild(host);

    pillEl.addEventListener("mouseenter", () => clearTimeout(hidePillTimer));
    pillEl.addEventListener("mouseleave", () => scheduleHidePill());
    pillEl.addEventListener("click", (e) => {
      if (e.target.closest(".pill-close")) {
        hidePill();
        return;
      }
      openPanel(currentUrl);
      hidePill();
    });

    closePanelBtn.addEventListener("click", () => {
      panelEl.classList.remove("open");
    });

    openTabBtn.addEventListener("click", () => {
      window.open("https://cobalt.canine.tools/", "_blank", "noopener");
    });

    pasteBtn.addEventListener("click", async () => {
      const res = await chrome.runtime.sendMessage({ type: "READ_CLIPBOARD" }).catch(() => null);
      if (res?.ok && res.text) {
        urlInp.value = res.text.trim();
      }
    });

    goBtn.addEventListener("click", submitMiniDownload);
    urlInp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitMiniDownload();
    });

    let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;
    header.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true;
      const rect = panelEl.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      panelEl.style.right = "auto";
      panelEl.style.bottom = "auto";
      panelEl.style.left = `${origLeft}px`;
      panelEl.style.top = `${origTop}px`;
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      const nx = Math.max(8, Math.min(window.innerWidth - 372, origLeft + (e.clientX - startX)));
      const ny = Math.max(8, Math.min(window.innerHeight - 120, origTop + (e.clientY - startY)));
      panelEl.style.left = `${nx}px`;
      panelEl.style.top = `${ny}px`;
    });
    window.addEventListener("mouseup", () => { dragging = false; });

    syncFromStorage();
  }

  function setMode(mode) {
    currentMode = mode;
    if (!shadow) return;
    shadow.querySelectorAll(".mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
  }

  function showPillAt(url, x, y) {
    if (!copyTriggerEnabled) return;
    ensureShadow();
    currentUrl = url;
    const clampedX = Math.max(12, Math.min(window.innerWidth - 130, x + 10));
    const clampedY = Math.max(12, Math.min(window.innerHeight - 48, y + 10));
    pillEl.style.left = `${clampedX}px`;
    pillEl.style.top = `${clampedY}px`;
    pillEl.style.display = "inline-flex";
    scheduleHidePill();
  }

  function hidePill() {
    clearTimeout(hidePillTimer);
    if (pillEl) pillEl.style.display = "none";
  }

  function scheduleHidePill() {
    clearTimeout(hidePillTimer);
    hidePillTimer = setTimeout(() => {
      if (pillEl) pillEl.style.display = "none";
    }, 8500);
  }

  function openPanel(url) {
    ensureShadow();
    const input = shadow.getElementById("mini-url");
    if (url) input.value = url;
    else if (!input.value) input.value = window.location.href;
    panelEl.classList.add("open");
    syncFromStorage();
  }

  async function submitMiniDownload() {
    const input = shadow.getElementById("mini-url");
    const goBtn = shadow.getElementById("mini-go");
    const url = input.value.trim();
    if (!url) return;

    goBtn.disabled = true;
    renderJobState({ status: "queued", message: "Sending link to Cobalt..." });

    const res = await chrome.runtime.sendMessage({
      type: "ENQUEUE_DOWNLOAD",
      url,
      mode: currentMode
    }).catch(() => ({ ok: false, error: "Could not reach extension background." }));

    goBtn.disabled = false;
    if (!res?.ok) {
      renderJobState({ status: "error", message: res?.error || "Failed to send URL." });
    }
  }

  function renderJobState(jobState) {
    if (!shadow || !panelEl?.classList.contains("open")) return;
    const box = shadow.getElementById("mini-status");
    if (!jobState || !jobState.status || Date.now() - (jobState.updatedAt || Date.now()) > 180000) {
      box.className = "status-box";
      box.replaceChildren();
      return;
    }

    const tone =
      jobState.status === "error" ? "err" :
      jobState.status === "done" ? "ok" :
      jobState.status === "turnstile_needs_human" ? "warn" : "";

    box.className = `status-box visible ${tone}`.trim();
    box.replaceChildren();

    const msg = document.createElement("div");
    msg.textContent = jobState.message || jobState.status;
    box.appendChild(msg);

    if (jobState.status === "turnstile_needs_human") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "turnstile-btn";
      btn.textContent = "Verify Cloudflare (open mini window)";
      btn.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "OPEN_TURNSTILE_HELPER" }).catch(() => {});
      });
      box.appendChild(btn);
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
      box.append(toolbar, grid, saveBtn);
    }
  }

  function renderDownloads(items) {
    if (!shadow) return;
    const sec = shadow.getElementById("mini-downloads");
    const list = shadow.getElementById("mini-dl-list");
    if (!Array.isArray(items) || !items.length) {
      sec.classList.remove("visible");
      list.replaceChildren();
      return;
    }

    sec.classList.add("visible");
    list.replaceChildren();

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

      list.appendChild(card);
    });
  }

  async function syncFromStorage() {
    const data = await chrome.storage.local.get(["settings", "jobState", "recentDownloads"]).catch(() => ({}));
    if (data.settings) {
      copyTriggerEnabled = data.settings.copyTriggerEnabled !== false;
      if (data.settings.defaultMode) setMode(data.settings.defaultMode);
    }
    if (data.jobState) renderJobState(data.jobState);
    if (data.recentDownloads) renderDownloads(data.recentDownloads);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings?.newValue) {
      copyTriggerEnabled = changes.settings.newValue.copyTriggerEnabled !== false;
    }
    if (changes.jobState?.newValue) renderJobState(changes.jobState.newValue);
    if (changes.recentDownloads?.newValue) renderDownloads(changes.recentDownloads.newValue);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "OPEN_MINI_WIDGET") {
      openPanel(message.url || window.location.href);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  document.addEventListener("mousemove", (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (pendingContextLink && !clipboardCheckPending && Date.now() - pendingContextLink.ts < 12000) {
      clipboardCheckPending = true;
      setTimeout(async () => {
        clipboardCheckPending = false;
        const target = pendingContextLink;
        pendingContextLink = null;
        if (!target) return;
        const res = await chrome.runtime.sendMessage({ type: "READ_CLIPBOARD" }).catch(() => null);
        const copied = extractUrl(res?.text || "");
        if (copied && copied === target.url) {
          showPillAt(copied, target.x, target.y);
        }
      }, 220);
    }
  }, { passive: true });

  document.addEventListener("copy", (e) => {
    const raw = e.clipboardData?.getData("text/plain") || window.getSelection()?.toString() || "";
    const url = extractUrl(raw);
    if (!url) return;

    let x = lastPointer.x, y = lastPointer.y;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        x = rect.right;
        y = rect.top;
      }
    }
    showPillAt(url, x, y);
  });

  document.addEventListener("selectionchange", () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString()?.trim() || "";
      if (!text || text.length > 350) return;
      const url = extractUrl(text);
      if (!url || !sel.rangeCount) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) {
        showPillAt(url, rect.right, rect.top);
      }
    }, 280);
  });

  document.addEventListener("contextmenu", (e) => {
    const anchor = e.target?.closest?.("a[href]");
    if (!anchor) {
      pendingContextLink = null;
      return;
    }
    const url = extractUrl(anchor.href);
    if (!url) return;
    const rect = anchor.getBoundingClientRect();
    pendingContextLink = {
      url,
      x: rect.right || e.clientX,
      y: rect.top || e.clientY,
      ts: Date.now()
    };
  });

  syncFromStorage();
})();
