import type { BrowserActionEnvelope, SubmitActionPayload, SyncScope } from "../../types";
import { buildScopeForElement, findFormByKey, getFormKeyFromForm } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function normalizeSubmitPayload(raw: unknown): SubmitActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const formKey = typeof r.formKey === "string" ? r.formKey.trim() : "";
  if (!formKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  return { formKey, scope };
}

function isScopeCompatibleForForm(scope: SyncScope | undefined): boolean {
  if (!scope) return false;
  if (scope.origin !== window.location.origin) return false;
  return true;
}

export class SubmitActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.formSubmit;
  readonly listenedEventTypes = ["submit"] as const;

  capture(event: Event): SubmitActionPayload | null {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) return null;

    const formKey = getFormKeyFromForm(target);
    if (!formKey) return null;

    const scope: SyncScope = buildScopeForElement(target);

    return { formKey, scope };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeSubmitPayload(payload);
    return p ? `submit:${p.formKey}` : null;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeSubmitPayload(action.payload);
    if (!payload) return;

    const form = findFormByKey(payload.formKey);
    if (!form) return;
    if (!isScopeCompatibleForForm(payload.scope)) return;

    context.markMutedField(`submit:${payload.formKey}`);

    try {
      form.requestSubmit();
    } catch (_error) {
      try { form.submit(); } catch (_e) { /* no-op */ }
    }

    context.logger.debug(`applied submit formKey=${payload.formKey}`);
  }
}
