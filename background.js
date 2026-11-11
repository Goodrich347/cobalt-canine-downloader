const COBALT_ORIGIN = "https://cobalt.canine.tools";
const COBALT_URL = `${COBALT_ORIGIN}/`;

const DEFAULT_SETTINGS = {
  defaultMode: "auto",
  reuseTab: true,
  silentBackground: true,
  autoCloseHelper: false,
  copyTriggerEnabled: true
};

let progressPollTimer = null;

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

function normalizeHttpUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  const match = raw.trim().match(/https?:\/\/[^\s<>"'`]+/i);
  if (!match) return null;
  try {
    const u = new URL(match[0]);
    if (u.protocol === "http:" || u.protocol === "https:") {
      if (u.origin === COBALT_ORIGIN) return null;
      return u.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "cobalt-root",
      title: "Download with Cobalt",
      contexts: ["link", "page", "selection", "video", "audio"]
    });
    chrome.contextMenus.create({
      id: "cobalt-mode-auto",
      parentId: "cobalt-root",
      title: "Auto (Video + Audio)",
      contexts: ["link", "page", "selection", "video", "audio"]
    });
    chrome.contextMenus.create({
      id: "cobalt-mode-audio",
      parentId: "cobalt-root",
      title: "Audio only",
      contexts: ["link", "page", "selection", "video", "audio"]
    });
    chrome.contextMenus.create({
      id: "cobalt-mode-mute",
      parentId: "cobalt-root",
      title: "Mute (Video only)",
      contexts: ["link", "page", "selection", "video", "audio"]
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { settings } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...(settings || {}) } });
  setupContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
});

async function ensureOffscreen() {
  if (!chrome.offscreen) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL("offscreen.html")]
  });
  if (contexts.length > 0) return true;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["CLIPBOARD"],
    justification: "Read copied media URLs on user demand."
  });
  return true;
}

async function readClipboardText() {
  try {
    await ensureOffscreen();
    const res = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "READ_CLIPBOARD"
    });
    return res || { ok: false, error: "Clipboard unavailable" };
  } catch (err) {
    return { ok: false, error: err?.message || "Clipboard unavailable" };
  }
}

async function setJobState(patch) {
  const { jobState } = await chrome.storage.local.get("jobState");
  const next = { ...(jobState || {}), ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ jobState: next });
  return next;
}

async function dispatchToCobalt(url, modeOverride, sourceTabId = null) {
  const cleanUrl = normalizeHttpUrl(url);
  if (!cleanUrl) {
    return { ok: false, error: "Invalid or unsupported URL (http/https only)." };
  }

  const settings = await getSettings();
  const mode = ["auto", "audio", "mute"].includes(modeOverride)
    ? modeOverride
    : settings.defaultMode;

  const job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url: cleanUrl,
    mode,
    sourceTabId,
    createdAt: Date.now()
  };

  await chrome.storage.local.set({ pendingJob: job });
  await setJobState({
    jobId: job.id,
    url: job.url,
    mode: job.mode,
    status: "queued",
    message: "Sending to Cobalt...",
    pickerItems: [],
    helperTabId: null,
    sourceTabId
  });

  if (settings.reuseTab) {
    const tabs = await chrome.tabs.query({ url: `${COBALT_ORIGIN}/*` });
    const targetTab = tabs.find((t) => typeof t.id === "number");
    if (targetTab) {
      if (!settings.silentBackground) {
        await chrome.tabs.update(targetTab.id, { active: true });
        if (typeof targetTab.windowId === "number") {
          await chrome.windows.update(targetTab.windowId, { focused: true }).catch(() => {});
        }
      }
      await setJobState({ helperTabId: targetTab.id });
      try {
        await chrome.tabs.sendMessage(targetTab.id, {
          type: "RUN_COBALT_JOB",
          job
        });
        return { ok: true, tabId: targetTab.id, reused: true, jobId: job.id };
      } catch {
        await chrome.tabs.reload(targetTab.id);
        return { ok: true, tabId: targetTab.id, reloaded: true, jobId: job.id };
      }
    }
  }

  const created = await chrome.tabs.create({
    url: COBALT_URL,
    active: !settings.silentBackground
  });

  if (typeof created.id === "number") {
    await setJobState({ helperTabId: created.id });
    await chrome.storage.session.set({
      managedTab: { tabId: created.id, jobId: job.id, createdAt: Date.now() }
    });
  }

  return { ok: true, tabId: created.id, reused: false, jobId: job.id };
}

async function openHelperForTurnstile() {
  const { jobState } = await chrome.storage.local.get("jobState");
  let tabId = jobState?.helperTabId;
  if (!tabId) {
    const tabs = await chrome.tabs.query({ url: `${COBALT_ORIGIN}/*` });
    tabId = tabs[0]?.id;
  }
  if (!tabId) return { ok: false };

  const win = await chrome.windows.create({
    tabId,
    type: "popup",
    width: 460,
    height: 560,
    focused: true
  }).catch(async () => {
    await chrome.tabs.update(tabId, { active: true });
    return null;
  });

  if (win?.id) {
    await chrome.storage.session.set({ turnstilePopupWindowId: win.id });
  }
  return { ok: true };
}

function summarizeDownload(item) {
  const rawName = (item.filename || "").split(/[\\/]/).pop() || item.url?.split("/").pop()?.split("?")[0] || "cobalt-file";
  const total = item.totalBytes > 0 ? item.totalBytes : 0;
  const received = item.bytesReceived || 0;
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
  return {
    id: item.id,
    filename: rawName,
    state: item.state,
    bytesReceived: received,
    totalBytes: total,
    pct,
    startTime: item.startTime || new Date().toISOString()
  };
}

async function refreshTrackedDownloads() {
  const { trackedDownloadIds = [] } = await chrome.storage.local.get("trackedDownloadIds");
  if (!trackedDownloadIds.length) {
    if (progressPollTimer) {
      clearInterval(progressPollTimer);
      progressPollTimer = null;
    }
    return;
  }

  const items = [];
  let hasActive = false;
  for (const id of trackedDownloadIds) {
    const [found] = await chrome.downloads.search({ id });
    if (found) {
      items.push(summarizeDownload(found));
      if (found.state === "in_progress") hasActive = true;
    }
  }

  await chrome.storage.local.set({ recentDownloads: items });

  if (!hasActive && progressPollTimer) {
    clearInterval(progressPollTimer);
    progressPollTimer = null;
  }
}

function startDownloadPolling() {
  if (progressPollTimer) return;
  progressPollTimer = setInterval(() => {
    refreshTrackedDownloads().catch(() => {});
  }, 600);
}

async function registerTrackedDownload(downloadId) {
  const { trackedDownloadIds = [] } = await chrome.storage.local.get("trackedDownloadIds");
  const nextIds = [downloadId, ...trackedDownloadIds.filter((x) => x !== downloadId)].slice(0, 12);
  await chrome.storage.local.set({ trackedDownloadIds: nextIds });
  await refreshTrackedDownloads();
  startDownloadPolling();
}

chrome.downloads.onCreated.addListener(async (item) => {
  const { jobState } = await chrome.storage.local.get("jobState");
  const isRecentJob = jobState && Date.now() - (jobState.updatedAt || 0) < 90000;
  const fromCobalt =
    (item.referrer || "").includes("cobalt.canine.tools") ||
    (item.url || "").includes("canine.tools") ||
    isRecentJob;

  if (!fromCobalt) return;

  await registerTrackedDownload(item.id);

  const { turnstilePopupWindowId } = await chrome.storage.session.get("turnstilePopupWindowId");
  if (turnstilePopupWindowId) {
    setTimeout(() => {
      chrome.windows.remove(turnstilePopupWindowId).catch(() => {});
    }, 900);
    await chrome.storage.session.remove("turnstilePopupWindowId");
  }
});

chrome.downloads.onChanged.addListener(async (delta) => {
  const { trackedDownloadIds = [] } = await chrome.storage.local.get("trackedDownloadIds");
  if (!trackedDownloadIds.includes(delta.id)) return;
  await refreshTrackedDownloads();
});

async function downloadSelectedUrls(items) {
  const valid = (Array.isArray(items) ? items : []).filter(
    (it) => it && typeof it.url === "string" && /^https?:\/\//i.test(it.url)
  );
  if (!valid.length) return { ok: false, error: "No downloadable URLs found." };

  let started = 0;
  for (let i = 0; i < valid.length; i++) {
    try {
      const downloadId = await chrome.downloads.download({
        url: valid[i].url,
        conflictAction: "uniquify",
        saveAs: false
      });
      if (typeof downloadId === "number") {
        started++;
        await registerTrackedDownload(downloadId);
      }
    } catch {}
    if (i < valid.length - 1) {
      await new Promise((r) => setTimeout(r, 180));
    }
  }

  return started > 0
    ? { ok: true, count: started }
    : { ok: false, error: "Failed to start selected downloads." };
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const modeMap = {
    "cobalt-mode-auto": "auto",
    "cobalt-mode-audio": "audio",
    "cobalt-mode-mute": "mute"
  };
  const mode = modeMap[info.menuItemId];
  if (!mode) return;

  const candidate =
    info.linkUrl ||
    info.srcUrl ||
    normalizeHttpUrl(info.selectionText) ||
    info.pageUrl ||
    tab?.url;

  if (candidate) {
    await dispatchToCobalt(candidate, mode, tab?.id ?? null);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "download-current-tab") return;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) return;

  try {
    await chrome.tabs.sendMessage(activeTab.id, {
      type: "OPEN_MINI_WIDGET",
      url: normalizeHttpUrl(activeTab.url) || ""
    });
  } catch {
    if (activeTab.url) {
      await dispatchToCobalt(activeTab.url, null, activeTab.id);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "ENQUEUE_DOWNLOAD") {
    dispatchToCobalt(message.url, message.mode, sender?.tab?.id ?? message.sourceTabId ?? null)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err?.message || "Failed" }));
    return true;
  }

  if (message.type === "DOWNLOAD_BATCH") {
    downloadSelectedUrls(message.items)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err?.message || "Failed" }));
    return true;
  }

  if (message.type === "READ_CLIPBOARD") {
    readClipboardText()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: err?.message || "Failed" }));
    return true;
  }

  if (message.type === "OPEN_TURNSTILE_HELPER") {
    openHelperForTurnstile()
      .then((res) => sendResponse(res))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "CLICK_PICKER_ITEM") {
    (async () => {
      const { jobState } = await chrome.storage.local.get("jobState");
      const tabId = jobState?.helperTabId;
      if (!tabId) return sendResponse({ ok: false });
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: "COBALT_CLICK_PICKER",
          index: message.index
        });
        sendResponse({ ok: true });
      } catch {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (message.type === "OPEN_DOWNLOAD") {
    chrome.downloads.open(message.id);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "SHOW_DOWNLOAD") {
    chrome.downloads.show(message.id);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "COBALT_BRIDGE_STATUS") {
    (async () => {
      const patch = {
        status: message.status,
        message: message.message || "",
        pickerItems: message.pickerItems || []
      };
      if (sender?.tab?.id) patch.helperTabId = sender.tab.id;
      await setJobState(patch);

      const settings = await getSettings();
      if (settings.autoCloseHelper && message.status === "done") {
        const { managedTab } = await chrome.storage.session.get("managedTab");
        const senderTabId = sender?.tab?.id;
        if (managedTab && senderTabId === managedTab.tabId && message.jobId === managedTab.jobId) {
          setTimeout(() => {
            chrome.tabs.remove(senderTabId).catch(() => {});
          }, 2200);
          await chrome.storage.session.remove("managedTab");
        }
      }
    })();
    return false;
  }

  return false;
});
