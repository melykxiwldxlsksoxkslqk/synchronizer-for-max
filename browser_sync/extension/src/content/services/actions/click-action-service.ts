import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, ClickActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

const TEXT_VALUE_INPUT_TYPES = new Set([
  "text", "password", "email", "search", "tel", "url", "number", "date",
  "datetime-local", "month", "week", "time", "color", "range",
]);

function isTextValueInput(element: HTMLElement): boolean {
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLSelectElement) return true;
  if (element instanceof HTMLInputElement) {
    const type = (element.type || "text").toLowerCase();
    return TEXT_VALUE_INPUT_TYPES.has(type);
  }
  return false;
}

function resolveClickTarget(rawTarget: EventTarget | null): HTMLElement | null {
  if (rawTarget instanceof HTMLElement) return rawTarget;
  let node: Node | null = rawTarget instanceof Node ? rawTarget : null;
  while (node) {
    if (node instanceof HTMLElement) return node;
    node = node.parentNode;
  }
  return null;
}

function normalizeClickPayload(raw: unknown): ClickActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const fieldKey = typeof record.fieldKey === "string" ? record.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(record.scope);
  if (!scope) return null;

  const button = typeof record.button === "number" && Number.isFinite(record.button)
    ? record.button
    : 0;

  return {
    fieldKey,
    scope,
    button,
    altKey: !!record.altKey,
    ctrlKey: !!record.ctrlKey,
    shiftKey: !!record.shiftKey,
    metaKey: !!record.metaKey,
  };
}

export class ClickActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.mouseClick;
  readonly listenedEventTypes = ["click"] as const;

  capture(event: Event): ClickActionPayload | null {
    if (!(event instanceof MouseEvent)) return null;
    const target = resolveClickTarget(event.target);
    if (!target) return null;
    if (isTextValueInput(target)) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      button: event.button,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    };
  }

  getMuteKey(payload: unknown): string | null {
    const normalized = normalizeClickPayload(payload);
    return normalized?.fieldKey || null;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeClickPayload(action.payload);
    if (!payload) {
      context.logger.info("click apply: invalid payload");
      return;
    }

    const target = findElementByKey(payload.fieldKey);
    if (!target) {
      context.logger.debug(`click apply: element not found key=${payload.fieldKey}`);
      return;
    }
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) {
      context.logger.debug(`click apply: scope mismatch key=${payload.fieldKey}`);
      return;
    }

    context.markMutedField(payload.fieldKey, DEFAULT_MUTE_WINDOW_MS);

    const commonInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      button: payload.button,
      altKey: payload.altKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      metaKey: payload.metaKey,
    };

    try {
      target.dispatchEvent(new PointerEvent("pointerdown", { ...commonInit, pointerId: 1, pointerType: "mouse" }));
      target.dispatchEvent(new MouseEvent("mousedown", commonInit));
      target.dispatchEvent(new PointerEvent("pointerup", { ...commonInit, pointerId: 1, pointerType: "mouse" }));
      target.dispatchEvent(new MouseEvent("mouseup", commonInit));
      target.dispatchEvent(new MouseEvent("click", commonInit));
    } catch (_error) { /* no-op */ }

    context.logger.info(`click apply OK key=${payload.fieldKey} tag=${target.tagName}`);
  }
}
