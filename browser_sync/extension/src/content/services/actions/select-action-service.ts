import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, SelectActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function normalizeSelectPayload(raw: unknown): SelectActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const selectionStart = typeof r.selectionStart === "number" ? r.selectionStart : 0;
  const selectionEnd = typeof r.selectionEnd === "number" ? r.selectionEnd : 0;
  const selectionDirection = typeof r.selectionDirection === "string" ? r.selectionDirection : "none";

  return { fieldKey, scope, selectionStart, selectionEnd, selectionDirection };
}

export class SelectActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.textSelect;
  readonly listenedEventTypes = ["select"] as const;

  capture(event: Event): SelectActionPayload | null {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      selectionStart: target.selectionStart ?? 0,
      selectionEnd: target.selectionEnd ?? 0,
      selectionDirection: target.selectionDirection ?? "none",
    };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeSelectPayload(payload);
    return p?.fieldKey || null;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeSelectPayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) return;
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return;

    context.markMutedField(payload.fieldKey, DEFAULT_MUTE_WINDOW_MS);

    try {
      target.setSelectionRange(
        payload.selectionStart,
        payload.selectionEnd,
        payload.selectionDirection as "forward" | "backward" | "none",
      );
    } catch (_error) { /* no-op: some input types don't support selection */ }

    context.logger.debug(`applied select key=${payload.fieldKey} [${payload.selectionStart}:${payload.selectionEnd}]`);
  }
}
