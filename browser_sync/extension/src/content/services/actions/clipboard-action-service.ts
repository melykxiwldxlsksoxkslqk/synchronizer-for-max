import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, ClipboardActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

const CLIPBOARD_EVENTS = new Set(["copy", "cut", "paste"]);

function normalizeClipboardPayload(raw: unknown): ClipboardActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const eventType = typeof r.eventType === "string" && CLIPBOARD_EVENTS.has(r.eventType)
    ? (r.eventType as "copy" | "cut" | "paste")
    : null;
  if (!eventType) return null;

  return { fieldKey, scope, eventType };
}

export class ClipboardActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.clipboard;
  readonly listenedEventTypes = ["copy", "cut", "paste"] as const;

  capture(event: Event): ClipboardActionPayload | null {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    if (!CLIPBOARD_EVENTS.has(event.type)) return null;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      eventType: event.type as "copy" | "cut" | "paste",
    };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeClipboardPayload(payload);
    if (!p) return null;
    return `${p.fieldKey}:${p.eventType}`;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeClipboardPayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) return;
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    context.markMutedField(`${payload.fieldKey}:${payload.eventType}`, DEFAULT_MUTE_WINDOW_MS);

    try {
      target.focus();
    } catch (_error) { /* no-op */ }

    try {
      document.execCommand(payload.eventType);
    } catch (_error) {
      try {
        target.dispatchEvent(new ClipboardEvent(payload.eventType, { bubbles: true, cancelable: true }));
      } catch (_e) { /* no-op */ }
    }

    context.logger.debug(`applied clipboard(${payload.eventType}) key=${payload.fieldKey}`);
  }
}
