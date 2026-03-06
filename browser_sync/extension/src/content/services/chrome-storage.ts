export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type StorageChanges = Record<string, StorageChange>;
type StorageChangeListener = (changes: StorageChanges, areaName: string) => void;

interface ChromeRuntimeApi {
  lastError?: { message?: string };
}

interface ChromeStorageApi {
  local: {
    get(keys: unknown, callback: (items: Record<string, unknown>) => void): void;
    set(items: Record<string, unknown>, callback?: () => void): void;
    remove(keys: unknown, callback?: () => void): void;
  };
  onChanged: {
    addListener(listener: StorageChangeListener): void;
    removeListener(listener: StorageChangeListener): void;
  };
}

interface ChromeApi {
  runtime?: ChromeRuntimeApi;
  storage?: ChromeStorageApi;
}

function getChromeApi(): ChromeApi {
  return (globalThis as unknown as { chrome?: ChromeApi }).chrome || {};
}

function runtimeErrorMessage(chromeApi: ChromeApi): string | null {
  const message = chromeApi.runtime?.lastError?.message;
  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }
  return null;
}

export function hasStorageApi(): boolean {
  const chromeApi = getChromeApi();
  return !!chromeApi.storage?.local?.get && !!chromeApi.storage?.local?.set;
}

export function addStorageChangeListener(listener: StorageChangeListener): () => void {
  const chromeApi = getChromeApi();
  chromeApi.storage?.onChanged?.addListener(listener);
  return () => {
    chromeApi.storage?.onChanged?.removeListener(listener);
  };
}

export async function storageGet<T extends Record<string, unknown>>(keys: unknown): Promise<T> {
  const chromeApi = getChromeApi();
  if (!chromeApi.storage?.local?.get) {
    throw new Error("chrome.storage.local.get is unavailable");
  }

  return await new Promise<T>((resolve, reject) => {
    chromeApi.storage?.local.get(keys, (items: Record<string, unknown>) => {
      const message = runtimeErrorMessage(chromeApi);
      if (message) {
        reject(new Error(message));
        return;
      }
      resolve((items || {}) as T);
    });
  });
}

export async function storageSet(items: Record<string, unknown>): Promise<void> {
  const chromeApi = getChromeApi();
  if (!chromeApi.storage?.local?.set) {
    throw new Error("chrome.storage.local.set is unavailable");
  }

  await new Promise<void>((resolve, reject) => {
    chromeApi.storage?.local.set(items, () => {
      const message = runtimeErrorMessage(chromeApi);
      if (message) {
        reject(new Error(message));
        return;
      }
      resolve();
    });
  });
}

export async function storageRemove(keys: unknown): Promise<void> {
  const chromeApi = getChromeApi();
  if (!chromeApi.storage?.local?.remove) {
    throw new Error("chrome.storage.local.remove is unavailable");
  }

  await new Promise<void>((resolve, reject) => {
    chromeApi.storage?.local.remove(keys, () => {
      const message = runtimeErrorMessage(chromeApi);
      if (message) {
        reject(new Error(message));
        return;
      }
      resolve();
    });
  });
}
