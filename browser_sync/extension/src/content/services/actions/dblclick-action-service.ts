import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, DblClickActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function normalizeDblClickPayload(raw: unknown): DblClickActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  return {
    fieldKey,
    scope,
    button: typeof r.button === "number" ? r.button : 0,
    altKey: !!r.altKey,
    ctrlKey: !!r.ctrlKey,
    shiftKey: !!r.shiftKey,
    metaKey: !!r.metaKey,
  };
}

export class DblClickActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.mouseDblClick;
  readonly listenedEventTypes = ["dblclick"] as const;

  capture(event: Event): DblClickActionPayload | null {
    if (!(event instanceof MouseEvent)) return null;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;

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
    const p = normalizeDblClickPayload(payload);
    return p?.fieldKey || null;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeDblClickPayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) return;
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    context.markMutedField(payload.fieldKey, DEFAULT_MUTE_WINDOW_MS);

    const init: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      button: payload.button,
      altKey: payload.altKey,
      ctrlKey: payload.ctrlKey,
      shiftKey: payload.shiftKey,
      metaKey: payload.metaKey,
    };

    try {
      target.dispatchEvent(new MouseEvent("dblclick", init));
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied dblclick key=${payload.fieldKey}`);
  }
}
