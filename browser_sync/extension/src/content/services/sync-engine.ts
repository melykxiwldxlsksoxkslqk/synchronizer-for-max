import { DEFAULT_MUTE_WINDOW_MS, DEFAULT_SYNC_CONFIG, LEGACY_KEYS, SEEN_ACTION_TTL_MS, STORAGE_KEYS } from "../constants";
import type { ActionSourceKind, BrowserActionEnvelope, SyncConfig } from "../types";
import { createId } from "../utils/id";
import {
  addStorageChangeListener,
  hasStorageApi,
  storageGet,
  storageRemove,
  storageSet,
  type StorageChanges,
} from "./chrome-storage";
import type { BrowserActionService } from "./actions/action-service";
import type { Logger } from "./logger";

interface StartSyncEngineOptions {
  logger: Logger;
  actionServices: BrowserActionService[];
}

const ACTION_ITEM_PREFIX = `${STORAGE_KEYS.actionBus}:`;
const ACTION_ITEM_TTL_MS = 10 * 60 * 1000;
const ACTION_CLEANUP_EVERY_PUBLISHES = 50;
const ACTION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const METRICS_LOG_INTERVAL_MS = 20_000;
const DEBUG_SAMPLE_FIRST = 5;
const DEBUG_SAMPLE_EVERY = 100;

const VERBOSE_ACTION_TYPES = new Set([
  "mouse.click",
  "keyboard.key",
  "form.submit",
  "element.focus",
]);

type EngineMetrics = {
  captureEventsTotal: number;
  captureEventsDroppedDisabled: number;
  captureEventsDroppedUntrusted: number;
  captureEventsDroppedInProgress: number;
  captureEventsDroppedThrottled: number;
  captureEventsDroppedNoPayload: number;
  captureEventsDroppedMuted: number;
  actionsPublished: number;
  actionsPublishErrors: number;
  actionsReceived: number;
  actionsDroppedInvalidEnvelope: number;
  actionsDroppedWrongSession: number;
  actionsDroppedSelf: number;
  actionsDroppedNonUser: number;
  actionsDroppedDuplicate: number;
  actionsDroppedUnsupported: number;
  actionsApplied: number;
  actionsApplyErrors: number;
  cleanupRuns: number;
  cleanupRemoved: number;
};

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return !!raw && typeof raw === "object";
}

function isExtensionContextInvalidated(error: unknown): boolean {
  const message = formatError(error).toLowerCase();
  return message.includes("extension context invalidated") || message.includes("context invalidated");
}

function isExtensionRuntimeAlive(): boolean {
  try {
    const chromeApi = (globalThis as unknown as { chrome?: { runtime?: { id?: unknown } } }).chrome;
    const runtimeId = chromeApi?.runtime?.id;
    return typeof runtimeId === "string" && runtimeId.length > 0;
  } catch (_error) {
    return false;
  }
}

function readLegacySessionId(): string | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEYS.roomId);
    if (!raw) return null;
    const value = raw.trim();
    return value || null;
  } catch (_error) {
    return null;
  }
}

function readLegacyEnabled(): boolean | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEYS.enabled);
    if (raw === null) return null;
    return raw !== "0" && raw !== "false";
  } catch (_error) {
    return null;
  }
}

function buildFallbackConfig(): SyncConfig {
  const fallback: SyncConfig = { ...DEFAULT_SYNC_CONFIG };
  const legacySessionId = readLegacySessionId();
  const legacyEnabled = readLegacyEnabled();

  if (legacySessionId) {
    fallback.sessionId = legacySessionId;
  }
  if (legacyEnabled !== null) {
    fallback.enabled = legacyEnabled;
  }
  return fallback;
}

function normalizeSyncConfig(raw: unknown, fallback: SyncConfig): SyncConfig {
  if (!isRecord(raw)) {
    return { ...fallback };
  }

  const rawEnabled = raw.enabled;
  const rawSessionId = raw.sessionId;

  const enabled = typeof rawEnabled === "boolean" ? rawEnabled : fallback.enabled;
  const sessionId = typeof rawSessionId === "string" && rawSessionId.trim()
    ? rawSessionId.trim()
    : fallback.sessionId;

  return { enabled, sessionId };
}

function normalizeSourceKind(raw: unknown): ActionSourceKind {
  return raw === "simulation" ? "simulation" : "user";
}

function normalizeActionEnvelope(raw: unknown): BrowserActionEnvelope | null {
  if (!isRecord(raw)) return null;

  const actionId = typeof raw.actionId === "string" ? raw.actionId.trim() : "";
  const actionType = typeof raw.actionType === "string" ? raw.actionType.trim() : "";
  const sessionId = typeof raw.sessionId === "string" ? raw.sessionId.trim() : "";
  const sourceApplicationId = typeof raw.sourceApplicationId === "string" ? raw.sourceApplicationId.trim() : "";
  const hasPayload = Object.prototype.hasOwnProperty.call(raw, "payload");

  if (!actionId || !actionType || !sessionId || !sourceApplicationId || !hasPayload) {
    return null;
  }

  return {
    actionId,
    actionType,
    sessionId,
    sourceApplicationId,
    sourceKind: normalizeSourceKind(raw.sourceKind),
    timestampMs:
      typeof raw.timestampMs === "number" && Number.isFinite(raw.timestampMs)
        ? raw.timestampMs
        : Date.now(),
    payload: raw.payload,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function startSyncEngine(options: StartSyncEngineOptions): Promise<() => void> {
  const { logger, actionServices } = options;
  const log = logger.child("engine");
  if (!hasStorageApi()) {
    log.error("chrome.storage API is unavailable in content script");
    return () => {};
  }

  const serviceByType = new Map<string, BrowserActionService>();
  const servicesByEventType = new Map<string, BrowserActionService[]>();

  actionServices.forEach((service) => {
    serviceByType.set(service.actionType, service);
    service.listenedEventTypes.forEach((eventType) => {
      const current = servicesByEventType.get(eventType) || [];
      current.push(service);
      servicesByEventType.set(eventType, current);
    });
  });

  log.info("action services registered", {
    services: actionServices.map((service) => ({
      actionType: service.actionType,
      events: service.listenedEventTypes,
      throttleMs: service.throttleMs || 0,
    })),
  });

  const applicationId = createId("app");
  const muteUntilByFieldKey = new Map<string, number>();
  const seenActionIds = new Map<string, number>();
  const debugSampleCounters = new Map<string, number>();
  const publishedByType = new Map<string, number>();
  const appliedByType = new Map<string, number>();
  const metrics: EngineMetrics = {
    captureEventsTotal: 0,
    captureEventsDroppedDisabled: 0,
    captureEventsDroppedUntrusted: 0,
    captureEventsDroppedInProgress: 0,
    captureEventsDroppedThrottled: 0,
    captureEventsDroppedNoPayload: 0,
    captureEventsDroppedMuted: 0,
    actionsPublished: 0,
    actionsPublishErrors: 0,
    actionsReceived: 0,
    actionsDroppedInvalidEnvelope: 0,
    actionsDroppedWrongSession: 0,
    actionsDroppedSelf: 0,
    actionsDroppedNonUser: 0,
    actionsDroppedDuplicate: 0,
    actionsDroppedUnsupported: 0,
    actionsApplied: 0,
    actionsApplyErrors: 0,
    cleanupRuns: 0,
    cleanupRemoved: 0,
  };
  // Guard flag against re-broadcasting events caused by remote action replay.
  let inProgressApplyCount = 0;
  let config = buildFallbackConfig();
  let publishCount = 0;
  let metricsTimer: number | null = null;
  let cleanupTimer: number | null = null;
  let engineStopped = false;
  let contextInvalidated = false;
  let removeStorageListener: (() => void) | null = null;
  const domListeners: Array<{ target: EventTarget; eventType: string; listener: (event: Event) => void }> = [];

  const WINDOW_EVENT_TYPES = new Set(["popstate", "hashchange", "beforeunload"]);

  function nowMs(): number {
    return Date.now();
  }

  function bumpMetric(key: keyof EngineMetrics, amount = 1): void {
    metrics[key] += amount;
  }

  function bumpTypeCounter(counter: Map<string, number>, actionType: string): void {
    counter.set(actionType, (counter.get(actionType) || 0) + 1);
  }

  function mapToRecord(counter: Map<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    counter.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  function debugSample(bucket: string, message: string, meta?: unknown): void {
    const next = (debugSampleCounters.get(bucket) || 0) + 1;
    debugSampleCounters.set(bucket, next);
    if (next <= DEBUG_SAMPLE_FIRST || (next % DEBUG_SAMPLE_EVERY) === 0) {
      log.debug(`${message} [${bucket}#${next}]`, meta);
    }
  }

  function shortId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) : id;
  }

  function actionSummary(action: BrowserActionEnvelope): Record<string, unknown> {
    const payload = isRecord(action.payload) ? action.payload : {};
    const fieldKey = typeof payload.fieldKey === "string" ? payload.fieldKey : undefined;
    return {
      actionId: shortId(action.actionId),
      actionType: action.actionType,
      sessionId: action.sessionId,
      sourceApplicationId: shortId(action.sourceApplicationId),
      sourceKind: action.sourceKind,
      fieldKey,
      timestampMs: action.timestampMs,
    };
  }

  function stopEngine(reason: string, meta: Record<string, unknown> = {}): void {
    if (engineStopped) return;
    engineStopped = true;

    if (metricsTimer !== null) {
      window.clearInterval(metricsTimer);
      metricsTimer = null;
    }
    if (cleanupTimer !== null) {
      window.clearInterval(cleanupTimer);
      cleanupTimer = null;
    }

    if (removeStorageListener) {
      try {
        removeStorageListener();
      } catch (_error) {
        // no-op
      }
      removeStorageListener = null;
    }

    domListeners.forEach(({ target, eventType, listener }) => {
      target.removeEventListener(eventType, listener, true);
    });
    domListeners.length = 0;

    log.info("sync stopped", {
      sessionId: config.sessionId,
      applicationId: shortId(applicationId),
      reason,
      ...meta,
      metrics,
      publishedByType: mapToRecord(publishedByType),
      appliedByType: mapToRecord(appliedByType),
    });
  }

  function handleRuntimeError(
    stage: string,
    error: unknown,
    meta: Record<string, unknown> = {},
  ): boolean {
    if (!isExtensionContextInvalidated(error)) {
      return false;
    }

    if (!contextInvalidated) {
      contextInvalidated = true;
      log.info(
        "extension context invalidated; stopping stale content-script instance (reload tab to reattach)",
        { stage, ...meta },
      );
    } else {
      debugSample("context.invalidated.repeat", "context invalidated error repeated", { stage });
    }
    stopEngine("context_invalidated", { stage });
    return true;
  }

  function ensureActiveContext(stage: string, meta: Record<string, unknown> = {}): boolean {
    if (engineStopped || contextInvalidated) {
      return false;
    }
    if (isExtensionRuntimeAlive()) {
      return true;
    }

    contextInvalidated = true;
    log.info("extension runtime is not alive; stopping stale content-script instance", {
      stage,
      ...meta,
    });
    stopEngine("context_not_alive", { stage });
    return false;
  }

  function markMutedField(fieldKey: string, durationMs = DEFAULT_MUTE_WINDOW_MS): void {
    if (!fieldKey) return;
    muteUntilByFieldKey.set(fieldKey, nowMs() + Math.max(0, durationMs));
  }

  function isMuted(fieldKey: string): boolean {
    const expiresAt = muteUntilByFieldKey.get(fieldKey) || 0;
    if (!expiresAt) return false;
    if (expiresAt <= nowMs()) {
      muteUntilByFieldKey.delete(fieldKey);
      return false;
    }
    return true;
  }

  function rememberAction(actionId: string): void {
    if (!actionId) return;
    const expiresAt = nowMs() + SEEN_ACTION_TTL_MS;
    seenActionIds.set(actionId, expiresAt);
    seenActionIds.forEach((ttl, key) => {
      if (ttl <= nowMs()) {
        seenActionIds.delete(key);
      }
    });
  }

  function isApplyInProgress(): boolean {
    return inProgressApplyCount > 0;
  }

  function hasSeenAction(actionId: string): boolean {
    if (!actionId) return false;
    const expiresAt = seenActionIds.get(actionId) || 0;
    if (!expiresAt) return false;
    if (expiresAt <= nowMs()) {
      seenActionIds.delete(actionId);
      return false;
    }
    return true;
  }

  function applyRemoteAction(action: BrowserActionEnvelope): void {
    bumpMetric("actionsReceived");

    if (!config.enabled) {
      debugSample("drop.disabled", "skip remote action: sync disabled", {
        actionType: action.actionType,
        actionId: shortId(action.actionId),
      });
      return;
    }

    if (action.sessionId !== config.sessionId) {
      bumpMetric("actionsDroppedWrongSession");
      debugSample("drop.wrong-session", "skip remote action: different session", {
        expectedSessionId: config.sessionId,
        receivedSessionId: action.sessionId,
        actionType: action.actionType,
        actionId: shortId(action.actionId),
      });
      return;
    }
    if (action.sourceApplicationId === applicationId) {
      bumpMetric("actionsDroppedSelf");
      debugSample("drop.self", "skip remote action: same application id", actionSummary(action));
      return;
    }
    if (action.sourceKind !== "user") {
      bumpMetric("actionsDroppedNonUser");
      debugSample("drop.non-user", "skip remote action: sourceKind is not user", actionSummary(action));
      return;
    }
    if (hasSeenAction(action.actionId)) {
      bumpMetric("actionsDroppedDuplicate");
      debugSample("drop.duplicate", "skip remote action: actionId already seen", actionSummary(action));
      return;
    }

    rememberAction(action.actionId);

    const service = serviceByType.get(action.actionType);
    if (!service) {
      bumpMetric("actionsDroppedUnsupported");
      debugSample("drop.unsupported", "skip remote action: unsupported action type", actionSummary(action));
      return;
    }

    const verboseApply = VERBOSE_ACTION_TYPES.has(action.actionType);
    if (verboseApply) {
      const payloadRecord = isRecord(action.payload) ? action.payload : {};
      log.info(`APPLY START ${action.actionType} key=${payloadRecord.fieldKey || "?"} from=${shortId(action.sourceApplicationId)}`);
    }

    inProgressApplyCount += 1;
    try {
      service.apply(action, {
        logger: log.child(`action:${action.actionType}`),
        markMutedField,
      });
      bumpMetric("actionsApplied");
      bumpTypeCounter(appliedByType, action.actionType);
      if (verboseApply) {
        log.info(`APPLY OK ${action.actionType} actionId=${shortId(action.actionId)}`);
      } else {
        debugSample("apply.success", "applied remote action", actionSummary(action));
      }
    } catch (error) {
      bumpMetric("actionsApplyErrors");
      log.warn(`APPLY FAILED ${action.actionType}: ${formatError(error)}`, actionSummary(action));
    } finally {
      inProgressApplyCount = Math.max(0, inProgressApplyCount - 1);
    }
  }

  function buildActionStorageKey(action: BrowserActionEnvelope): string {
    const safeSession = (action.sessionId || "default-session").replace(/:/g, "_");
    return `${ACTION_ITEM_PREFIX}${safeSession}:${action.timestampMs}:${action.actionId}`;
  }

  async function cleanupStaleActionItems(): Promise<void> {
    if (!ensureActiveContext("cleanup-start")) return;
    try {
      bumpMetric("cleanupRuns");
      const snapshot = await storageGet<Record<string, unknown>>(null);
      const allEntries = Object.entries(snapshot)
        .filter(([key]) => key.startsWith(ACTION_ITEM_PREFIX));

      if (allEntries.length === 0) return;

      const now = nowMs();
      const staleKeys: string[] = [];
      for (const [key, value] of allEntries) {
        if (!isRecord(value)) {
          staleKeys.push(key);
          continue;
        }
        const ts = value.timestampMs;
        if (typeof ts !== "number" || !Number.isFinite(ts) || (now - ts) > ACTION_ITEM_TTL_MS) {
          staleKeys.push(key);
        }
      }

      if (staleKeys.length > 0) {
        await storageRemove(staleKeys);
        bumpMetric("cleanupRemoved", staleKeys.length);
        log.info("action-bus cleanup removed stale items", {
          removed: staleKeys.length,
          totalActionEntries: allEntries.length,
        });
      }
    } catch (error) {
      if (handleRuntimeError("cleanup", error)) return;
      log.debug(`action cleanup skipped: ${formatError(error)}`);
    }
  }

  function relayActionViaRuntime(action: BrowserActionEnvelope): void {
    try {
      const chromeApi = (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: (msg: unknown) => void } } }).chrome;
      chromeApi?.runtime?.sendMessage?.({
        type: "__bs_relay_action__",
        action,
      });
    } catch (_error) {
      // Service worker may not be available; storage fallback handles it.
    }
  }

  async function publishAction(action: BrowserActionEnvelope): Promise<void> {
    if (!ensureActiveContext("publish-start", actionSummary(action))) return;

    relayActionViaRuntime(action);

    const key = buildActionStorageKey(action);
    await storageSet({ [key]: action });
    bumpMetric("actionsPublished");
    bumpTypeCounter(publishedByType, action.actionType);
    debugSample("publish.success", "published action to storage", {
      ...actionSummary(action),
      storageKey: key,
    });

    publishCount += 1;
    if (publishCount % ACTION_CLEANUP_EVERY_PUBLISHES === 0) {
      void cleanupStaleActionItems();
    }
  }

  try {
    const snapshot = await storageGet<Record<string, unknown>>([STORAGE_KEYS.config]);
    const storedConfig = snapshot[STORAGE_KEYS.config];
    const normalized = normalizeSyncConfig(storedConfig, config);
    const shouldWriteBack = !isRecord(storedConfig)
      || storedConfig.enabled !== normalized.enabled
      || storedConfig.sessionId !== normalized.sessionId;
    config = normalized;
    if (shouldWriteBack) {
      await storageSet({ [STORAGE_KEYS.config]: normalized });
    }
    log.info("sync config initialized", {
      sessionId: config.sessionId,
      enabled: config.enabled,
      usedFallback: !isRecord(storedConfig),
    });
  } catch (error) {
    if (handleRuntimeError("config-init", error, {
      sessionId: config.sessionId,
      enabled: config.enabled,
    })) {
      return () => {
        stopEngine("context_invalidated_dispose");
      };
    }
    log.warn(`sync config init fallback: ${formatError(error)}`, {
      sessionId: config.sessionId,
      enabled: config.enabled,
    });
  }

  const lastPublishByActionType = new Map<string, number>();

  function isThrottled(service: BrowserActionService): boolean {
    const throttle = service.throttleMs;
    if (!throttle || throttle <= 0) return false;
    const lastTime = lastPublishByActionType.get(service.actionType) || 0;
    return (nowMs() - lastTime) < throttle;
  }

  function markPublished(service: BrowserActionService): void {
    if (service.throttleMs && service.throttleMs > 0) {
      lastPublishByActionType.set(service.actionType, nowMs());
    }
  }

  servicesByEventType.forEach((services, eventType) => {
    const listener = (event: Event): void => {
      if (!ensureActiveContext("capture-listener", { eventType })) {
        return;
      }
      if (!config.enabled) {
        bumpMetric("captureEventsDroppedDisabled");
        debugSample("capture.disabled", "skip capture: sync disabled", { eventType });
        return;
      }
      if (!event.isTrusted) {
        bumpMetric("captureEventsDroppedUntrusted");
        debugSample("capture.untrusted", "skip capture: event is not trusted", { eventType });
        return;
      }
      if (isApplyInProgress()) {
        bumpMetric("captureEventsDroppedInProgress");
        debugSample("capture.in-progress", "skip capture: apply in progress", {
          eventType,
          inProgressApplyCount,
        });
        return;
      }

      services.forEach((service) => {
        if (!ensureActiveContext("capture-service", { eventType, actionType: service.actionType })) {
          return;
        }
        bumpMetric("captureEventsTotal");
        const verbose = VERBOSE_ACTION_TYPES.has(service.actionType);
        try {
          if (isThrottled(service)) {
            bumpMetric("captureEventsDroppedThrottled");
            debugSample("capture.throttled", "skip capture: throttled", {
              eventType,
              actionType: service.actionType,
              throttleMs: service.throttleMs || 0,
            });
            return;
          }

          const payload = service.capture(event);
          if (!payload) {
            bumpMetric("captureEventsDroppedNoPayload");
            if (verbose) {
              const targetTag = event.target instanceof Element ? event.target.tagName : String(event.target);
              log.info(`CAPTURE NO-PAYLOAD ${service.actionType} event=${eventType} target=${targetTag}`);
            } else {
              debugSample("capture.no-payload", "skip capture: service returned no payload", {
                eventType,
                actionType: service.actionType,
              });
            }
            return;
          }

          const muteKey = service.getMuteKey(payload);
          if (muteKey && isMuted(muteKey)) {
            bumpMetric("captureEventsDroppedMuted");
            if (verbose) {
              log.info(`CAPTURE MUTED ${service.actionType} muteKey=${muteKey}`);
            } else {
              debugSample("capture.muted", "skip capture: mute key is active", {
                eventType,
                actionType: service.actionType,
                muteKey,
              });
            }
            return;
          }

          markPublished(service);

          const action: BrowserActionEnvelope = {
            actionId: createId("action"),
            actionType: service.actionType,
            sessionId: config.sessionId,
            sourceApplicationId: applicationId,
            sourceKind: "user",
            timestampMs: nowMs(),
            payload,
          };
          rememberAction(action.actionId);

          if (verbose) {
            const payloadRecord = isRecord(payload) ? payload : {};
            log.info(`CAPTURE OK ${service.actionType} key=${payloadRecord.fieldKey || "?"} actionId=${shortId(action.actionId)}`);
          }

          void publishAction(action).catch((error) => {
            if (handleRuntimeError("publish", error, actionSummary(action))) {
              return;
            }
            bumpMetric("actionsPublishErrors");
            log.warn(`action publish failed: ${formatError(error)}`, actionSummary(action));
          });
        } catch (error) {
          log.warn(`capture failed for ${service.actionType}: ${formatError(error)}`, { eventType });
        }
      });
    };

    const target = WINDOW_EVENT_TYPES.has(eventType) ? window : document;
    target.addEventListener(eventType, listener, true);
    domListeners.push({ target, eventType, listener });
  });

  removeStorageListener = addStorageChangeListener((changes: StorageChanges, areaName: string) => {
    if (!ensureActiveContext("storage-listener", { areaName })) return;
    if (areaName !== "local") return;

    const configChange = changes[STORAGE_KEYS.config];
    if (configChange && Object.prototype.hasOwnProperty.call(configChange, "newValue")) {
      const nextConfig = normalizeSyncConfig(configChange.newValue, config);
      const changed = nextConfig.enabled !== config.enabled || nextConfig.sessionId !== config.sessionId;
      config = nextConfig;
      if (changed) {
        log.info("sync config updated from storage", {
          sessionId: config.sessionId,
          enabled: config.enabled,
        });
      }
    }

    Object.entries(changes).forEach(([key, change]) => {
      if (!key.startsWith(ACTION_ITEM_PREFIX)) return;
      if (!Object.prototype.hasOwnProperty.call(change, "newValue")) return;

      const action = normalizeActionEnvelope(change.newValue);
      if (!action) {
        bumpMetric("actionsDroppedInvalidEnvelope");
        debugSample("drop.invalid-envelope", "skip action: invalid envelope shape", {
          storageKey: key,
        });
        return;
      }

      debugSample("storage.change", "received action-bus storage change", {
        storageKey: key,
        actionId: shortId(action.actionId),
        actionType: action.actionType,
      });
      applyRemoteAction(action);
    });
  });

  try {
    const chromeApi = (globalThis as unknown as {
      chrome?: { runtime?: {
        sendMessage?: (msg: unknown) => void;
        onMessage?: { addListener: (cb: (msg: unknown) => void) => void };
      } }
    }).chrome;
    chromeApi?.runtime?.onMessage?.addListener((message: unknown) => {
      if (!ensureActiveContext("runtime-message")) return;
      if (!isRecord(message)) return;

      if (message.type === "__bs_action__") {
        const action = normalizeActionEnvelope(message.action);
        if (!action) return;

        debugSample("runtime.message", "received action via runtime message", {
          actionId: shortId(action.actionId),
          actionType: action.actionType,
        });
        applyRemoteAction(action);
        return;
      }

      if (message.type === "__bs_navigation__") {
        try { if (window.top !== window) return; } catch (_e) { return; }
        const url = typeof message.url === "string" ? message.url : "";
        const msgSessionId = typeof message.sessionId === "string" ? message.sessionId : "";
        if (!url || !msgSessionId) return;
        if (msgSessionId !== config.sessionId) {
          debugSample("nav.wrong-session", "skip navigation: different session");
          return;
        }
        if (url === window.location.href) return;

        log.info(`navigation sync: navigating to ${url}`);
        try {
          chromeApi?.runtime?.sendMessage?.({
            type: "__bs_navigate_tab__",
            url,
          });
        } catch (_e) { /* no-op */ }
        return;
      }
    });
    log.info("runtime message listener attached");
  } catch (_error) {
    log.debug("runtime.onMessage unavailable, relying on storage listener only");
  }

  window.addEventListener("message", (event) => {
    if (!event.data || typeof event.data !== "object") return;
    if (event.data.type !== "__bs_sync_control__") return;
    if (typeof event.data.enabled !== "boolean") return;

    const newEnabled = event.data.enabled;
    if (newEnabled === config.enabled) return;

    config = { ...config, enabled: newEnabled };
    void storageSet({ [STORAGE_KEYS.config]: config }).catch(() => {});
    log.info(`sync control received: enabled=${newEnabled}`);
  });

  cleanupTimer = window.setInterval(() => {
    if (!ensureActiveContext("periodic-cleanup")) return;
    void cleanupStaleActionItems();
  }, ACTION_CLEANUP_INTERVAL_MS);

  metricsTimer = window.setInterval(() => {
    log.info("engine metrics snapshot", {
      sessionId: config.sessionId,
      enabled: config.enabled,
      applicationId: shortId(applicationId),
      metrics,
      publishedByType: mapToRecord(publishedByType),
      appliedByType: mapToRecord(appliedByType),
      activeMutes: muteUntilByFieldKey.size,
      seenActions: seenActionIds.size,
    });
  }, METRICS_LOG_INTERVAL_MS);

  log.info("sync started", {
    sessionId: config.sessionId,
    enabled: config.enabled,
    applicationId: shortId(applicationId),
    listeners: Array.from(servicesByEventType.keys()),
    services: actionServices.length,
  });

  const diagWindow = window as unknown as Record<string, unknown>;
  diagWindow.__BS_SYNC_STATE__ = {
    get config() { return { ...config }; },
    get applicationId() { return applicationId; },
    get metrics() { return { ...metrics }; },
    get publishedByType() { return mapToRecord(publishedByType); },
    get appliedByType() { return mapToRecord(appliedByType); },
    get engineStopped() { return engineStopped; },
    get contextInvalidated() { return contextInvalidated; },
    get activeMutes() { return muteUntilByFieldKey.size; },
    get seenActions() { return seenActionIds.size; },
    get registeredEvents() { return Array.from(servicesByEventType.keys()); },
  };

  return () => {
    stopEngine("manual_dispose");
  };
}
