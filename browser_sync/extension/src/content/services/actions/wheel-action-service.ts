import type { BrowserActionEnvelope, WheelActionPayload } from "../../types";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function normalizeWheelPayload(raw: unknown): WheelActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  return {
    scope,
    deltaX: typeof r.deltaX === "number" && Number.isFinite(r.deltaX) ? r.deltaX : 0,
    deltaY: typeof r.deltaY === "number" && Number.isFinite(r.deltaY) ? r.deltaY : 0,
    deltaMode: typeof r.deltaMode === "number" ? r.deltaMode : 0,
    targetKey: typeof r.targetKey === "string" ? r.targetKey : undefined,
  };
}

export class WheelActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.wheel;
  readonly listenedEventTypes = ["wheel"] as const;
  readonly throttleMs = 200;

  capture(event: Event): WheelActionPayload | null {
    if (!(event instanceof WheelEvent)) return null;

    return {
      scope: {
        origin: window.location.origin,
        path: window.location.pathname,
        formKey: "no-form",
      },
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
    };
  }

  getMuteKey(_payload: unknown): string | null {
    return "__wheel__";
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeWheelPayload(action.payload);
    if (!payload) return;

    if (payload.scope.origin !== window.location.origin) return;
    if (payload.scope.path !== window.location.pathname) return;

    context.markMutedField("__wheel__", 250);

    try {
      window.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: payload.deltaX,
        deltaY: payload.deltaY,
        deltaMode: payload.deltaMode,
      }));
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied wheel dX=${payload.deltaX} dY=${payload.deltaY}`);
  }
}
