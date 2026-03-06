import type { BrowserActionEnvelope, WheelActionPayload } from "../../types";
import { findElementByKey, keyOf } from "../../utils/dom-key";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

const LINE_HEIGHT_PX = 40;
const PAGE_HEIGHT_PX = 800;

function deltaToPixels(delta: number, mode: number): number {
  if (mode === WheelEvent.DOM_DELTA_LINE) return delta * LINE_HEIGHT_PX;
  if (mode === WheelEvent.DOM_DELTA_PAGE) return delta * PAGE_HEIGHT_PX;
  return delta;
}

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

function resolveScrollTarget(event: WheelEvent): HTMLElement | null {
  let el: Element | null = event.target instanceof Element ? event.target : null;
  while (el && el !== document.documentElement) {
    if (el instanceof HTMLElement) {
      const style = getComputedStyle(el);
      const oy = style.overflowY;
      const ox = style.overflowX;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return el;
      if ((ox === "auto" || ox === "scroll") && el.scrollWidth > el.clientWidth) return el;
    }
    el = el.parentElement;
  }
  return null;
}

export class WheelActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.wheel;
  readonly listenedEventTypes = ["wheel"] as const;
  readonly throttleMs = 60;

  capture(event: Event): WheelActionPayload | null {
    if (!(event instanceof WheelEvent)) return null;

    const scrollTarget = resolveScrollTarget(event);
    const targetKey = scrollTarget ? keyOf(scrollTarget) : undefined;

    return {
      scope: {
        origin: window.location.origin,
        path: window.location.pathname,
        formKey: "no-form",
      },
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      targetKey: targetKey || undefined,
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

    context.markMutedField("__wheel__", 120);

    const pxX = deltaToPixels(payload.deltaX, payload.deltaMode);
    const pxY = deltaToPixels(payload.deltaY, payload.deltaMode);

    if (payload.targetKey) {
      const el = findElementByKey(payload.targetKey);
      if (el) {
        try {
          el.scrollBy({ left: pxX, top: pxY, behavior: "instant" });
        } catch (_e) {
          el.scrollTop += pxY;
          el.scrollLeft += pxX;
        }
        context.logger.debug(`wheel apply element key=${payload.targetKey} dY=${pxY}`);
        return;
      }
    }

    try {
      window.scrollBy({ left: pxX, top: pxY, behavior: "instant" });
    } catch (_e) {
      window.scrollBy(pxX, pxY);
    }

    context.logger.debug(`wheel apply doc dX=${pxX} dY=${pxY}`);
  }
}
