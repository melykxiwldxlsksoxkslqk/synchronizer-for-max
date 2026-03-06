import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, MouseDownActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMouseDownPayload(raw: unknown): MouseDownActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const fieldKey = typeof record.fieldKey === "string" ? record.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(record.scope);
  if (!scope) return null;

  return {
    fieldKey,
    scope,
    button: asNumber(record.button, 0),
    clientX: asNumber(record.clientX, 0),
    clientY: asNumber(record.clientY, 0),
    altKey: !!record.altKey,
    ctrlKey: !!record.ctrlKey,
    shiftKey: !!record.shiftKey,
    metaKey: !!record.metaKey,
  };
}

export class MouseDownActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.mouseDown;
  readonly listenedEventTypes = ["mousedown"] as const;

  capture(event: Event): MouseDownActionPayload | null {
    if (!(event instanceof MouseEvent)) return null;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    };
  }

  getMuteKey(payload: unknown): string | null {
    const normalized = normalizeMouseDownPayload(payload);
    return normalized?.fieldKey || null;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeMouseDownPayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) return;
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    context.markMutedField(payload.fieldKey, DEFAULT_MUTE_WINDOW_MS);

    const init: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      button: payload.button,
      clientX: payload.clientX,
      clientY: payload.clientY,
      altKey: payload.altKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      metaKey: payload.metaKey,
    };

    try {
      target.dispatchEvent(new MouseEvent("mousedown", init));
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied mousedown key=${payload.fieldKey}`);
  }
}
