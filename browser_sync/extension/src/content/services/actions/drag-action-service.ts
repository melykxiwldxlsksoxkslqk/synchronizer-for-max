import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, DragActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

const DRAG_EVENTS = new Set([
  "dragstart", "dragend", "drop", "drag", "dragenter", "dragleave", "dragover",
]);

type DragEventType = DragActionPayload["eventType"];

function normalizeDragPayload(raw: unknown): DragActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const eventType = typeof r.eventType === "string" && DRAG_EVENTS.has(r.eventType)
    ? (r.eventType as DragEventType)
    : null;
  if (!eventType) return null;

  return { fieldKey, scope, eventType };
}

const THROTTLED_DRAG_EVENTS = new Set(["drag", "dragover"]);

export class DragActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.drag;
  readonly listenedEventTypes = [
    "dragstart", "dragend", "drop", "drag", "dragenter", "dragleave", "dragover",
  ] as const;
  readonly throttleMs = 50;

  capture(event: Event): DragActionPayload | null {
    if (!(event instanceof DragEvent)) return null;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    if (!DRAG_EVENTS.has(event.type)) return null;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      eventType: event.type as DragEventType,
    };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeDragPayload(payload);
    if (!p) return null;
    return `drag:${p.fieldKey}:${p.eventType}`;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeDragPayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) return;
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    context.markMutedField(`drag:${payload.fieldKey}:${payload.eventType}`, DEFAULT_MUTE_WINDOW_MS);

    try {
      target.dispatchEvent(new DragEvent(payload.eventType, {
        bubbles: true,
        cancelable: payload.eventType !== "dragleave",
      }));
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied drag(${payload.eventType}) key=${payload.fieldKey}`);
  }
}
