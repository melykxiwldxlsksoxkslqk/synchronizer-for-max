import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, KeyboardActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function resolveKeyboardTarget(rawTarget: EventTarget | null): HTMLElement | null {
  if (rawTarget instanceof HTMLElement) return rawTarget;
  const active = document.activeElement;
  if (active instanceof HTMLElement) return active;
  return document.body instanceof HTMLElement ? document.body : null;
}

function normalizeKeyboardPayload(raw: unknown): KeyboardActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const key = typeof r.key === "string" ? r.key : "";
  const code = typeof r.code === "string" ? r.code : "";
  if (!key && !code) return null;

  const eventType = r.eventType === "keyup"
    ? "keyup" as const
    : r.eventType === "keypress"
      ? "keypress" as const
      : "keydown" as const;

  return {
    fieldKey,
    scope,
    eventType,
    key,
    code,
    altKey: !!r.altKey,
    ctrlKey: !!r.ctrlKey,
    shiftKey: !!r.shiftKey,
    metaKey: !!r.metaKey,
    repeat: !!r.repeat,
  };
}

function isEnterPayload(payload: KeyboardActionPayload): boolean {
  return payload.key === "Enter" || payload.code === "Enter";
}

function applyEnterAction(target: HTMLElement, context: ActionApplyContext): void {
  if (target instanceof HTMLTextAreaElement || target.isContentEditable) return;

  if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) {
    try { target.click(); } catch (_error) { /* no-op */ }
    return;
  }

  const role = (target.getAttribute("role") || "").toLowerCase();
  if (role === "button" || role === "link" || role === "menuitem" || role === "tab") {
    try { target.click(); } catch (_error) { /* no-op */ }
    return;
  }

  if (target instanceof HTMLInputElement) {
    const type = (target.type || "").toLowerCase();
    if (type === "button" || type === "submit" || type === "reset") {
      try { target.click(); } catch (_error) { /* no-op */ }
      return;
    }

    const form = target.closest("form");
    if (form instanceof HTMLFormElement) {
      try {
        form.requestSubmit();
      } catch (_error) {
        try { form.submit(); } catch (_e) { /* no-op */ }
      }
      context.logger.debug("enter: submitted form via requestSubmit");
      return;
    }

    try { target.click(); } catch (_error) { /* no-op */ }
    context.logger.debug("enter: clicked standalone input (no form)");
    return;
  }

  const form = target.closest("form");
  if (form instanceof HTMLFormElement) {
    try {
      form.requestSubmit();
    } catch (_error) {
      try { form.submit(); } catch (_e) { /* no-op */ }
    }
    context.logger.debug("enter: submitted form");
    return;
  }

  try { target.click(); } catch (_error) { /* no-op */ }
  context.logger.debug("enter: click fallback on generic element");
}

function focusTargetForKeyboardReplay(target: HTMLElement): void {
  if (typeof target.focus !== "function") return;
  try {
    target.focus({ preventScroll: true });
  } catch (_error) {
    try { target.focus(); } catch (_e) { /* no-op */ }
  }
}

function patchLegacyKeyCodes(event: KeyboardEvent, payload: KeyboardActionPayload): void {
  const keyCodeMap: Record<string, number> = {
    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Home: 36, End: 35, PageUp: 33, PageDown: 34, Space: 32,
  };
  const kc = keyCodeMap[payload.key] || keyCodeMap[payload.code] || 0;
  if (!kc) return;
  try { Object.defineProperty(event, "keyCode", { get: () => kc }); } catch (_error) { /* no-op */ }
  try { Object.defineProperty(event, "which", { get: () => kc }); } catch (_error) { /* no-op */ }
  if (payload.eventType === "keypress") {
    try { Object.defineProperty(event, "charCode", { get: () => kc }); } catch (_error) { /* no-op */ }
  }
}

export class KeyboardActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.keyboardKey;
  readonly listenedEventTypes = ["keydown", "keyup", "keypress"] as const;

  capture(event: Event): KeyboardActionPayload | null {
    if (!(event instanceof KeyboardEvent)) return null;

    const target = resolveKeyboardTarget(event.target);
    if (!target) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      eventType: event.type === "keyup" ? "keyup" : event.type === "keypress" ? "keypress" : "keydown",
      key: event.key,
      code: event.code,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
    };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeKeyboardPayload(payload);
    if (!p) return null;
    return `${p.fieldKey}:${p.eventType}:${p.code}`;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeKeyboardPayload(action.payload);
    if (!payload) {
      context.logger.info("keyboard apply: invalid payload");
      return;
    }

    const target = findElementByKey(payload.fieldKey);
    if (!target) {
      context.logger.info(`keyboard apply: element not found key=${payload.fieldKey}`);
      return;
    }
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) {
      context.logger.debug(`keyboard apply: scope mismatch key=${payload.fieldKey}`);
      return;
    }

    context.markMutedField(`${payload.fieldKey}:${payload.eventType}:${payload.code}`, DEFAULT_MUTE_WINDOW_MS);
    focusTargetForKeyboardReplay(target);

    const init: KeyboardEventInit = {
      bubbles: true,
      cancelable: true,
      key: payload.key,
      code: payload.code,
      altKey: payload.altKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      metaKey: payload.metaKey,
      repeat: payload.repeat,
    };

    try {
      const keyboardEvent = new KeyboardEvent(payload.eventType, init);
      patchLegacyKeyCodes(keyboardEvent, payload);
      target.dispatchEvent(keyboardEvent);
    } catch (_error) { /* no-op */ }

    if (payload.eventType === "keydown" && isEnterPayload(payload)) {
      applyEnterAction(target, context);
    }

    context.logger.info(`keyboard apply OK (${payload.eventType}) key=${payload.key} target=${payload.fieldKey} tag=${target.tagName}`);
  }
}
