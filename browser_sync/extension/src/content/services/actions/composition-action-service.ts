import { DEFAULT_MUTE_WINDOW_MS } from "../../constants";
import type { BrowserActionEnvelope, CompositionActionPayload } from "../../types";
import { buildScopeForElement, findElementByKey, isScopeCompatible, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

const COMPOSITION_EVENTS = new Set(["compositionstart", "compositionupdate", "compositionend"]);

type CompositionEventType = CompositionActionPayload["eventType"];

function normalizeCompositionPayload(raw: unknown): CompositionActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const fieldKey = typeof r.fieldKey === "string" ? r.fieldKey.trim() : "";
  if (!fieldKey) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const eventType = typeof r.eventType === "string" && COMPOSITION_EVENTS.has(r.eventType)
    ? (r.eventType as CompositionEventType)
    : null;
  if (!eventType) return null;

  const data = typeof r.data === "string" ? r.data : "";

  return { fieldKey, scope, eventType, data };
}

function resolveCompositionTarget(rawTarget: EventTarget | null): HTMLElement | null {
  if (rawTarget instanceof HTMLElement) return rawTarget;
  const active = document.activeElement;
  if (active instanceof HTMLElement) return active;
  return null;
}

export class CompositionActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.composition;
  readonly listenedEventTypes = ["compositionstart", "compositionupdate", "compositionend"] as const;

  capture(event: Event): CompositionActionPayload | null {
    if (!(event instanceof CompositionEvent)) return null;

    const target = resolveCompositionTarget(event.target);
    if (!target) return null;

    const fieldKey = keyOf(target);
    if (!fieldKey) return null;

    if (!COMPOSITION_EVENTS.has(event.type)) return null;

    return {
      fieldKey,
      scope: buildScopeForElement(target),
      eventType: event.type as CompositionEventType,
      data: event.data || "",
    };
  }

  getMuteKey(payload: unknown): string | null {
    const p = normalizeCompositionPayload(payload);
    if (!p) return null;
    return `composition:${p.fieldKey}:${p.eventType}`;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeCompositionPayload(action.payload);
    if (!payload) {
      context.logger.info("composition apply: invalid payload");
      return;
    }

    const target = findElementByKey(payload.fieldKey);
    if (!target) {
      context.logger.info(`composition apply: element not found key=${payload.fieldKey}`);
      return;
    }
    if (!isScopeCompatible(payload.scope, target, payload.fieldKey)) {
      context.logger.info(`composition apply: scope mismatch key=${payload.fieldKey}`);
      return;
    }

    context.markMutedField(`composition:${payload.fieldKey}:${payload.eventType}`, DEFAULT_MUTE_WINDOW_MS);

    try {
      if (typeof target.focus === "function") {
        target.focus({ preventScroll: true });
      }
    } catch (_error) { /* no-op */ }

    try {
      target.dispatchEvent(new CompositionEvent(payload.eventType, {
        bubbles: true,
        cancelable: true,
        data: payload.data,
      }));
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied composition(${payload.eventType}) key=${payload.fieldKey} data="${payload.data}"`);
  }
}
