import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, MouseEnterLeaveActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMouseEnterLeavePayload(raw: unknown): MouseEnterLeaveActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const eventType = r.eventType === "mouseleave" ? "mouseleave" as const : "mouseenter" as const;

  const relatedTargetKey =
    typeof r.relatedTargetKey === "string" && r.relatedTargetKey.trim()
      ? r.relatedTargetKey.trim()
      : undefined;

  return {
    fieldKey,
    scope,
    eventType,
    clientX: asNumber(r.clientX, 0),
    clientY: asNumber(r.clientY, 0),
    altKey: !!r.altKey,
    ctrlKey: !!r.ctrlKey,
    shiftKey: !!r.shiftKey,
    metaKey: !!r.metaKey,
    relatedTargetKey,
  };
}

export class MouseEnterLeaveActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.mouseEnterLeave;
  readonly listenedEventTypes = ["mouseenter", "mouseleave"] as const;
  readonly throttleMs = 30;

  capture(event: Event): MouseEnterLeaveActionPayload | null {
    if (!(event instanceof MouseEvent)) return null;

    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    const relatedTargetKey =
      event.relatedTarget instanceof HTMLElement
        ? keyOf(event.relatedTarget) || undefined
        : undefined;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      eventType: event.type === "mouseleave" ? "mouseleave" : "mouseenter",
      clientX: event.clientX,
      clientY: event.clientY,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      relatedTargetKey,
    };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeMouseEnterLeavePayload(payload);
    if (!p) return null;
    return `${p.fieldKey}:${p.eventType}`;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeMouseEnterLeavePayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) return;
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    context.markMutedField(`${payload.fieldKey}:${payload.eventType}`, DEFAULT_MUTE_WINDOW_MS);

    const relatedTarget = payload.relatedTargetKey
      ? findElementByKey(payload.relatedTargetKey)
      : null;

    const init: MouseEventInit = {
      bubbles: false,
      cancelable: false,
      clientX: payload.clientX,
      clientY: payload.clientY,
      altKey: payload.altKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      metaKey: payload.metaKey,
      relatedTarget,
    };

    try {
      target.dispatchEvent(new MouseEvent(payload.eventType, init));
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied ${payload.eventType} key=${payload.fieldKey}`);
  }
}
