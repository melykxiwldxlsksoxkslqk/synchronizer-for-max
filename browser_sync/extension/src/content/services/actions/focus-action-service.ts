import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, FocusActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function normalizeFocusPayload(raw: unknown): FocusActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const eventType = r.eventType === "blur" ? "blur" as const : "focus" as const;

  return { fieldKey, scope, eventType };
}

export class FocusActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.focus;
  readonly listenedEventTypes = ["focus", "blur"] as const;

  capture(event: Event): FocusActionPayload | null {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      eventType: event.type === "blur" ? "blur" : "focus",
    };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeFocusPayload(payload);
    return p?.fieldKey || null;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeFocusPayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) return;
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    context.markMutedField(payload.fieldKey, DEFAULT_MUTE_WINDOW_MS);

    try {
      if (payload.eventType === "focus") {
        target.focus();
      } else {
        target.blur();
      }
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied focus(${payload.eventType}) key=${payload.fieldKey}`);
  }
}
