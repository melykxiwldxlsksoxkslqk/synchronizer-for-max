import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, TouchActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

const TOUCH_EVENTS = new Set(["touchstart", "touchend", "touchmove", "touchcancel"]);

type TouchEventType = TouchActionPayload["eventType"];

function normalizeTouchPayload(raw: unknown): TouchActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const eventType = typeof r.eventType === "string" && TOUCH_EVENTS.has(r.eventType)
    ? (r.eventType as TouchEventType)
    : null;
  if (!eventType) return null;

  return {
    fieldKey,
    scope,
    eventType,
    touchCount: typeof r.touchCount === "number" ? r.touchCount : 1,
    primaryTouchX: typeof r.primaryTouchX === "number" ? r.primaryTouchX : 0,
    primaryTouchY: typeof r.primaryTouchY === "number" ? r.primaryTouchY : 0,
  };
}

function hasActiveTouches(eventType: TouchEventType): boolean {
  return eventType === "touchstart" || eventType === "touchmove";
}

export class TouchActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.touch;
  readonly listenedEventTypes = ["touchstart", "touchend", "touchmove", "touchcancel"] as const;
  readonly throttleMs = 30;

  capture(event: Event): TouchActionPayload | null {
    if (!(event instanceof TouchEvent)) return null;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    if (!TOUCH_EVENTS.has(event.type)) return null;

    const primaryTouch = event.touches[0] || event.changedTouches[0];
    const x = primaryTouch ? primaryTouch.clientX : 0;
    const y = primaryTouch ? primaryTouch.clientY : 0;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      eventType: event.type as TouchEventType,
      touchCount: event.touches.length || 1,
      primaryTouchX: x,
      primaryTouchY: y,
    };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeTouchPayload(payload);
    if (!p) return null;
    return `touch:${p.fieldKey}:${p.eventType}`;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeTouchPayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) return;
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    context.markMutedField(`touch:${payload.fieldKey}:${payload.eventType}`, DEFAULT_MUTE_WINDOW_MS);

    try {
      const touch = new Touch({
        identifier: 0,
        target,
        clientX: payload.primaryTouchX,
        clientY: payload.primaryTouchY,
      });
      const activeTouches = hasActiveTouches(payload.eventType);
      const init: TouchEventInit = {
        bubbles: true,
        cancelable: payload.eventType !== "touchcancel",
        touches: activeTouches ? [touch] : [],
        changedTouches: [touch],
        targetTouches: activeTouches ? [touch] : [],
      };
      target.dispatchEvent(new TouchEvent(payload.eventType, init));
    } catch (_error) { /* Touch API may be unavailable on desktop */ }

    context.logger.debug(`applied touch(${payload.eventType}) key=${payload.fieldKey}`);
  }
}
