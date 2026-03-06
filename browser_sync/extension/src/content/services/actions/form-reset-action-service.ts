import type { BrowserActionEnvelope, FormResetPayload, SyncScope } from "../../types";
import { buildScopeForElement, findFormByKey, getFormKeyFromForm } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function normalizeFormResetPayload(raw: unknown): FormResetPayload | null {
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

export class FormResetActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.formReset;
  readonly listenedEventTypes = ["reset"] as const;

  capture(event: Event): FormResetPayload | null {
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) return null;

    const formKey = getFormKeyFromForm(target);
    if (!formKey) return null;

    return {
      formKey,
      scope: buildScopeForElement(target),
    };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeFormResetPayload(payload);
    return p ? `reset:${p.formKey}` : null;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeFormResetPayload(action.payload);
    if (!payload) return;

    const form = findFormByKey(payload.formKey);
    if (!form) return;
    if (!isScopeCompatibleForForm(payload.scope)) return;

    context.markMutedField(`reset:${payload.formKey}`);

    try {
      form.reset();
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied form reset formKey=${payload.formKey}`);
  }
}
