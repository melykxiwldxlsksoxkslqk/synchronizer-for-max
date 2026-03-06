const ACTION_BUS_PREFIX = "__bs_action_bus_v1__:";
const CONFIG_KEY = "__bs_sync_config_v1__";
const MESSAGE_TYPE_ACTION = "__bs_action__";
const MESSAGE_TYPE_RELAY = "__bs_relay_action__";
const MESSAGE_TYPE_NAV = "__bs_navigation__";
const MESSAGE_TYPE_SYNC_NAV = "__bs_sync_nav_start__";
const SYNC_NAV_TTL_MS = 5000;

interface RelayMessage {
  type: typeof MESSAGE_TYPE_RELAY;
  action: unknown;
}

interface SyncNavMessage {
  type: typeof MESSAGE_TYPE_SYNC_NAV;
  url: string;
}

const syncInitiatedNavs = new Map<number, { url: string; ts: number }>();

function cleanExpiredSyncNavs(): void {
  const now = Date.now();
  syncInitiatedNavs.forEach((entry, tabId) => {
    if (now - entry.ts > SYNC_NAV_TTL_MS) syncInitiatedNavs.delete(tabId);
  });
}

function getSessionId(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get([CONFIG_KEY], (result) => {
      const config = result[CONFIG_KEY];
      if (config && typeof config === "object" && typeof config.sessionId === "string") {
        resolve(config.sessionId);
      } else {
        resolve("default-session");
      }
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === MESSAGE_TYPE_SYNC_NAV && sender.tab?.id != null) {
    syncInitiatedNavs.set(sender.tab.id, {
      url: String(message.url || ""),
      ts: Date.now(),
    });
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "__bs_navigate_tab__" && sender.tab?.id != null) {
    const url = String(message.url || "");
    if (url) {
      syncInitiatedNavs.set(sender.tab.id, { url, ts: Date.now() });
      chrome.tabs.update(sender.tab.id, { url });
    }
    sendResponse({ ok: true });
    return;
  }

  if (message.type === MESSAGE_TYPE_RELAY && message.action != null) {
    const senderTabId = sender.tab?.id;
    chrome.tabs.query({ active: true }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id == null || tab.id === senderTabId) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: MESSAGE_TYPE_ACTION,
          action: message.action,
        }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;

  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith(ACTION_BUS_PREFIX)) continue;
    if (!change.newValue) continue;

    chrome.tabs.query({ active: true }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id == null) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: MESSAGE_TYPE_ACTION,
          action: change.newValue,
        }).catch(() => {});
      }
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, _tab) => {
  if (!changeInfo.url) return;
  const url = changeInfo.url;

  cleanExpiredSyncNavs();
  const syncNav = syncInitiatedNavs.get(tabId);
  if (syncNav && syncNav.url === url) {
    syncInitiatedNavs.delete(tabId);
    return;
  }

  getSessionId().then((sessionId) => {
    chrome.tabs.query({ active: true }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id == null || tab.id === tabId) continue;
        chrome.tabs.sendMessage(tab.id, {
          type: MESSAGE_TYPE_NAV,
          url,
          sessionId,
        }).catch(() => {});
      }
    });
  });
});
