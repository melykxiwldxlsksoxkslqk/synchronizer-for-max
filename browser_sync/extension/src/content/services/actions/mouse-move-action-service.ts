import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, MouseMoveActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMouseMovePayload(raw: unknown): MouseMoveActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const fieldKey = typeof record.fieldKey === "string" ? record.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(record.scope);
  if (!scope) return null;

  return {
    fieldKey,
    scope,
    clientX: asNumber(record.clientX, 0),
    clientY: asNumber(record.clientY, 0),
    movementX: asNumber(record.movementX, 0),
    movementY: asNumber(record.movementY, 0),
    altKey: !!record.altKey,
    ctrlKey: !!record.ctrlKey,
    shiftKey: !!record.shiftKey,
    metaKey: !!record.metaKey,
  };
}

export class MouseMoveActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.mouseMove;
  readonly listenedEventTypes = ["mousemove"] as const;
  readonly throttleMs = 50;

  capture(event: Event): MouseMoveActionPayload | null {
    if (!(event instanceof MouseEvent)) return null;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      clientX: event.clientX,
      clientY: event.clientY,
      movementX: event.movementX,
      movementY: event.movementY,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    };
  }

  getMuteKey(payload: unknown): string | null {
    const normalized = normalizeMouseMovePayload(payload);
    return normalized?.fieldKey || null;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeMouseMovePayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) return;
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    context.markMutedField(payload.fieldKey, DEFAULT_MUTE_WINDOW_MS);

    const init: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: payload.clientX,
      clientY: payload.clientY,
      altKey: payload.altKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      metaKey: payload.metaKey,
    };

    try {
      target.dispatchEvent(new MouseEvent("mousemove", init));
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied mousemove key=${payload.fieldKey}`);
  }
}
