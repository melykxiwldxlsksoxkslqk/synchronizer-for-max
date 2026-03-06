import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, PointerActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

const POINTER_EVENT_TYPES = new Set([
  "pointerdown", "pointerup", "pointermove", "pointerover",
  "pointerout", "pointerenter", "pointerleave", "pointercancel",
]);

type PointerEventType = PointerActionPayload["eventType"];

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizePointerPayload(raw: unknown): PointerActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const eventType = typeof r.eventType === "string" && POINTER_EVENT_TYPES.has(r.eventType)
    ? (r.eventType as PointerEventType)
    : null;
  if (!eventType) return null;

  return {
    fieldKey,
    scope,
    eventType,
    pointerId: asNumber(r.pointerId, 0),
    width: asNumber(r.width, 1),
    height: asNumber(r.height, 1),
    pressure: asNumber(r.pressure, 0),
    tiltX: asNumber(r.tiltX, 0),
    tiltY: asNumber(r.tiltY, 0),
    pointerType: typeof r.pointerType === "string" ? r.pointerType : "mouse",
    isPrimary: typeof r.isPrimary === "boolean" ? r.isPrimary : true,
    clientX: asNumber(r.clientX, 0),
    clientY: asNumber(r.clientY, 0),
    button: asNumber(r.button, -1),
    altKey: !!r.altKey,
    ctrlKey: !!r.ctrlKey,
    shiftKey: !!r.shiftKey,
    metaKey: !!r.metaKey,
  };
}

export class PointerActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.pointer;
  readonly listenedEventTypes = [
    "pointerdown", "pointerup", "pointermove", "pointerover",
    "pointerout", "pointerenter", "pointerleave", "pointercancel",
  ] as const;
  readonly throttleMs = 30;

  capture(event: Event): PointerActionPayload | null {
    if (!(event instanceof PointerEvent)) return null;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    if (!POINTER_EVENT_TYPES.has(event.type)) return null;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      eventType: event.type as PointerEventType,
      pointerId: event.pointerId,
      width: event.width,
      height: event.height,
      pressure: event.pressure,
      tiltX: event.tiltX,
      tiltY: event.tiltY,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      clientX: event.clientX,
      clientY: event.clientY,
      button: event.button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizePointerPayload(payload);
    if (!p) return null;
    return `pointer:${p.fieldKey}:${p.eventType}`;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizePointerPayload(action.payload);
    if (!payload) {
      context.logger.info("pointer apply: invalid payload");
      return;
    }

    const target = findElementByKey(payload.fieldKey);
    if (!target) {
      context.logger.debug(`pointer apply: element not found key=${payload.fieldKey}`);
      return;
    }
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) {
      context.logger.debug(`pointer apply: scope mismatch key=${payload.fieldKey}`);
      return;
    }

    context.markMutedField(`pointer:${payload.fieldKey}:${payload.eventType}`, DEFAULT_MUTE_WINDOW_MS);

    const init: PointerEventInit = {
      bubbles: payload.eventType !== "pointerenter" && payload.eventType !== "pointerleave",
      cancelable: payload.eventType !== "pointerenter" && payload.eventType !== "pointerleave",
      pointerId: payload.pointerId,
      width: payload.width,
      height: payload.height,
      pressure: payload.pressure,
      tiltX: payload.tiltX,
      tiltY: payload.tiltY,
      pointerType: payload.pointerType,
      isPrimary: payload.isPrimary,
      clientX: payload.clientX,
      clientY: payload.clientY,
      button: payload.button,
      altKey: payload.altKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      metaKey: payload.metaKey,
    };

    try {
      target.dispatchEvent(new PointerEvent(payload.eventType, init));
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied pointer(${payload.eventType}) key=${payload.fieldKey} type=${payload.pointerType}`);
  }
}
