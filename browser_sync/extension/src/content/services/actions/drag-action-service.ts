import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, DragActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

const ALL_DRAG_EVENTS = new Set([
  "dragstart", "dragend", "drop", "drag", "dragenter", "dragleave", "dragover",
]);
const THROTTLED_EVENTS = new Set(["drag", "dragover", "dragenter", "dragleave"]);
const CRITICAL_EVENTS = new Set(["dragstart", "drop", "dragend"]);

type DragEventType = DragActionPayload["eventType"];

let activeDragSourceKey = "";

function resolveDropTarget(event: DragEvent): HTMLElement | null {
  const el = document.elementFromPoint(event.clientX, event.clientY);
  if (el instanceof HTMLElement) return el;
  return null;
}

function normalizeDragPayload(raw: unknown): DragActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const eventType = typeof r.eventType === "string" && ALL_DRAG_EVENTS.has(r.eventType)
    ? (r.eventType as DragEventType)
    : null;
  if (!eventType) return null;

  return {
    fieldKey,
    scope,
    eventType,
    clientX: typeof r.clientX === "number" && Number.isFinite(r.clientX) ? r.clientX : 0,
    clientY: typeof r.clientY === "number" && Number.isFinite(r.clientY) ? r.clientY : 0,
    screenX: typeof r.screenX === "number" && Number.isFinite(r.screenX) ? r.screenX : 0,
    screenY: typeof r.screenY === "number" && Number.isFinite(r.screenY) ? r.screenY : 0,
    sourceKey: typeof r.sourceKey === "string" ? r.sourceKey : "",
    dropTargetKey: typeof r.dropTargetKey === "string" ? r.dropTargetKey : undefined,
    effectAllowed: typeof r.effectAllowed === "string" ? r.effectAllowed : undefined,
    dropEffect: typeof r.dropEffect === "string" ? r.dropEffect : undefined,
  };
}

export class DragActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.drag;
  readonly listenedEventTypes = [
    "dragstart", "dragend", "drop", "drag", "dragenter", "dragleave", "dragover",
  ] as const;
  readonly throttleMs = 0;

  private lastThrottledAt = 0;
  private static readonly THROTTLE_INTERVAL = 80;

  capture(event: Event): DragActionPayload | null {
    if (!(event instanceof DragEvent)) return null;
    const eventType = event.type as DragEventType;
    if (!ALL_DRAG_EVENTS.has(eventType)) return null;

    if (THROTTLED_EVENTS.has(eventType)) {
      const now = Date.now();
      if (now - this.lastThrottledAt < DragActionService.THROTTLE_INTERVAL) return null;
      this.lastThrottledAt = now;
    }

    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    if (eventType === "dragstart") {
      activeDragSourceKey = fieldKey;
    }

    let dropTargetKey: string | undefined;
    if (eventType === "drop" || eventType === "dragover" || eventType === "dragenter") {
      const dropEl = resolveDropTarget(event);
      if (dropEl && dropEl !== target) {
        dropTargetKey = keyOf(dropEl) || undefined;
      }
    }

    const effectAllowed = event.dataTransfer?.effectAllowed || "uninitialized";
    const dropEffect = event.dataTransfer?.dropEffect || "none";

    const payload: DragActionPayload = {
      fieldKey,
      scope: buildScopeForElement(target),
      eventType,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      sourceKey: activeDragSourceKey || fieldKey,
      dropTargetKey,
      effectAllowed,
      dropEffect,
    };

    if (eventType === "dragend" || eventType === "drop") {
      activeDragSourceKey = "";
    }

    return payload;
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeDragPayload(payload);
    if (!p) return null;
    if (CRITICAL_EVENTS.has(p.eventType)) return null;
    return `drag:${p.eventType}`;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeDragPayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) {
      context.logger.debug(`drag apply: element not found key=${payload.fieldKey}`);
      return;
    }
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    const isCritical = CRITICAL_EVENTS.has(payload.eventType);
    if (isCritical) {
      context.markMutedField(`drag:${payload.fieldKey}:${payload.eventType}`, DEFAULT_MUTE_WINDOW_MS);
    } else {
      context.markMutedField(`drag:${payload.eventType}`, 100);
    }

    const eventTarget = payload.dropTargetKey
      ? (findElementByKey(payload.dropTargetKey) || target)
      : target;

    const init: DragEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: payload.clientX,
      clientY: payload.clientY,
      screenX: payload.screenX,
      screenY: payload.screenY,
    };

    try {
      switch (payload.eventType) {
        case "dragstart": {
          const dragStartEvt = new DragEvent("dragstart", init);
          target.dispatchEvent(dragStartEvt);
          context.logger.info(`drag apply: dragstart key=${payload.fieldKey}`);
          break;
        }
        case "drag": {
          target.dispatchEvent(new DragEvent("drag", init));
          break;
        }
        case "dragenter": {
          const enterEvt = new DragEvent("dragenter", { ...init, cancelable: true });
          eventTarget.dispatchEvent(enterEvt);
          break;
        }
        case "dragover": {
          const overEvt = new DragEvent("dragover", { ...init, cancelable: true });
          eventTarget.dispatchEvent(overEvt);
          overEvt.preventDefault();
          break;
        }
        case "dragleave": {
          eventTarget.dispatchEvent(new DragEvent("dragleave", { ...init, cancelable: false }));
          break;
        }
        case "drop": {
          const dropTarget = payload.dropTargetKey
            ? (findElementByKey(payload.dropTargetKey) || target)
            : target;

          const preOver = new DragEvent("dragover", { ...init, cancelable: true });
          dropTarget.dispatchEvent(preOver);

          const dropEvt = new DragEvent("drop", { ...init, cancelable: true });
          dropTarget.dispatchEvent(dropEvt);

          context.logger.info(
            `drag apply: drop sourceKey=${payload.sourceKey} targetKey=${payload.dropTargetKey || payload.fieldKey}`,
          );
          break;
        }
        case "dragend": {
          target.dispatchEvent(new DragEvent("dragend", { ...init, cancelable: false }));
          context.logger.info(`drag apply: dragend key=${payload.fieldKey}`);
          break;
        }
      }
    } catch (error) {
      context.logger.debug(
        `drag apply error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
