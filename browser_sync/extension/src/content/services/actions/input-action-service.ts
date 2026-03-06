import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, InputActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

const SUPPORTED_FORM_TAGS = new Set(["input", "textarea", "select"]);

function normalizeInputActionPayload(raw: unknown): InputActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const fieldKey = typeof record.fieldKey === "string" ? record.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(record.scope);
  if (!scope) return null;

  return {
    fieldKey,
    value: typeof record.value === "string" ? record.value : String(record.value ?? ""),
    checked: typeof record.checked === "boolean" ? record.checked : undefined,
    tag: typeof record.tag === "string" ? record.tag : undefined,
    inputType: typeof record.inputType === "string" ? record.inputType : undefined,
    isContentEditable: typeof record.isContentEditable === "boolean" ? record.isContentEditable : undefined,
    scope,
  };
}

export class InputActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.inputChanged;
  readonly listenedEventTypes = ["input", "change"] as const;

  capture(event: Event): InputActionPayload | null {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return null;

    const tag = (target.tagName || "").toLowerCase();
    if (!(SUPPORTED_FORM_TAGS.has(tag) || target.isContentEditable)) {
      return null;
    }

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    const payload: InputActionPayload = {
      fieldKey,
      value: "",
      checked: target instanceof HTMLInputElement ? !!target.checked : undefined,
      tag,
      inputType: target instanceof HTMLInputElement ? (target.type || "").toLowerCase() : undefined,
      isContentEditable: !!target.isContentEditable,
      scope: buildScopeForElement(target),
    };

    if (payload.isContentEditable) {
      payload.value = target.innerText || "";
    } else if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
    ) {
      payload.value = target.value != null ? String(target.value) : "";
    }

    return payload;
  }

  getMuteKey(payload: unknown): string | null {
    const normalized = normalizeInputActionPayload(payload);
    return normalized?.fieldKey || null;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeInputActionPayload(action.payload);
    if (!payload) return;

    const target = findElementByKey(payload.fieldKey);
    if (!target) return;
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) return;

    context.markMutedField(payload.fieldKey, DEFAULT_MUTE_WINDOW_MS);

    if (payload.isContentEditable || target.isContentEditable) {
      target.innerText = payload.value || "";
    } else if (target instanceof HTMLInputElement) {
      const inputType = (target.type || "").toLowerCase();
      if (inputType === "checkbox" || inputType === "radio") {
        target.checked = !!payload.checked;
      } else {
        target.value = payload.value || "";
      }
    } else if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      target.value = payload.value || "";
    }

    try {
      target.dispatchEvent(new Event("input", { bubbles: true }));
    } catch (_error) {}
    try {
      target.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (_error) {}

    context.logger.debug(`applied input action key=${payload.fieldKey}`);
  }
}
