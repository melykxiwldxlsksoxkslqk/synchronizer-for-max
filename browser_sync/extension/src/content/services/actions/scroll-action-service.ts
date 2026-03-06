import type { BrowserActionEnvelope, ScrollActionPayload } from "../../types";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function normalizeScrollPayload(raw: unknown): ScrollActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  const scrollX = typeof r.scrollX === "number" && Number.isFinite(r.scrollX) ? r.scrollX : 0;
  const scrollY = typeof r.scrollY === "number" && Number.isFinite(r.scrollY) ? r.scrollY : 0;
  const targetKey = typeof r.targetKey === "string" ? r.targetKey : undefined;

  return { scope, scrollX, scrollY, targetKey };
}

export class ScrollActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.scroll;
  readonly listenedEventTypes = ["scroll"] as const;
  readonly throttleMs = 250;

  capture(event: Event): ScrollActionPayload | null {
    const target = event.target;

    if (target === document || target === document.documentElement) {
      return {
        scope: {
          origin: window.location.origin,
          path: window.location.pathname,
          formKey: "no-form",
        },
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      };
    }

    return null;
  }

  getMuteKey(_payload: unknown): string | null {
    return "__scroll__";
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeScrollPayload(action.payload);
    if (!payload) return;

    if (payload.scope.origin !== window.location.origin) return;
    if (payload.scope.path !== window.location.pathname) return;

    context.markMutedField("__scroll__", 300);

    try {
      window.scrollTo({ left: payload.scrollX, top: payload.scrollY, behavior: "instant" });
    } catch (_error) { /* no-op */ }

    context.logger.debug(`applied scroll x=${payload.scrollX} y=${payload.scrollY}`);
  }
}
