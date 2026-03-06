import type { BrowserActionEnvelope, ScrollActionPayload } from "../../types";
import { findElementByKey, keyOf } from "../../utils/dom-key";
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
  const ratioX = typeof r.ratioX === "number" && Number.isFinite(r.ratioX) ? r.ratioX : 0;
  const ratioY = typeof r.ratioY === "number" && Number.isFinite(r.ratioY) ? r.ratioY : 0;
  const targetKey = typeof r.targetKey === "string" ? r.targetKey : undefined;

  return { scope, scrollX, scrollY, ratioX, ratioY, targetKey };
}

function computeScrollRatio(scrollPos: number, maxScroll: number): number {
  if (maxScroll <= 0) return 0;
  return Math.min(1, Math.max(0, scrollPos / maxScroll));
}

function isScrollableElement(el: Element): boolean {
  if (el === document.documentElement || el === document.body) return false;
  const style = getComputedStyle(el);
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;
  const scrollable = overflowY === "auto" || overflowY === "scroll"
    || overflowX === "auto" || overflowX === "scroll";
  return scrollable && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
}

export class ScrollActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.scroll;
  readonly listenedEventTypes = ["scroll"] as const;
  readonly throttleMs = 80;

  capture(event: Event): ScrollActionPayload | null {
    const target = event.target;

    if (target === document || target === document.documentElement) {
      const maxScrollX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const maxScrollY = document.documentElement.scrollHeight - document.documentElement.clientHeight;

      return {
        scope: {
          origin: window.location.origin,
          path: window.location.pathname,
          formKey: "no-form",
        },
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        ratioX: computeScrollRatio(window.scrollX, maxScrollX),
        ratioY: computeScrollRatio(window.scrollY, maxScrollY),
      };
    }

    if (target instanceof HTMLElement && isScrollableElement(target)) {
      const key = keyOf(target);
      if (!key) return null;

      const maxScrollLeft = target.scrollWidth - target.clientWidth;
      const maxScrollTop = target.scrollHeight - target.clientHeight;

      return {
        scope: {
          origin: window.location.origin,
          path: window.location.pathname,
          formKey: "no-form",
        },
        scrollX: target.scrollLeft,
        scrollY: target.scrollTop,
        ratioX: computeScrollRatio(target.scrollLeft, maxScrollLeft),
        ratioY: computeScrollRatio(target.scrollTop, maxScrollTop),
        targetKey: key,
      };
    }

    return null;
  }

  getMuteKey(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return "__scroll__";
    const p = payload as Record<string, unknown>;
    const key = typeof p.targetKey === "string" ? p.targetKey : "__doc__";
    return `__scroll__:${key}`;
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    const payload = normalizeScrollPayload(action.payload);
    if (!payload) return;

    if (payload.scope.origin !== window.location.origin) return;
    if (payload.scope.path !== window.location.pathname) return;

    const muteKey = `__scroll__:${payload.targetKey || "__doc__"}`;
    context.markMutedField(muteKey, 150);

    if (payload.targetKey) {
      const el = findElementByKey(payload.targetKey);
      if (!el) {
        context.logger.debug(`scroll apply: element not found key=${payload.targetKey}`);
        return;
      }

      const maxLeft = el.scrollWidth - el.clientWidth;
      const maxTop = el.scrollHeight - el.clientHeight;
      const targetLeft = maxLeft > 0 ? payload.ratioX * maxLeft : payload.scrollX;
      const targetTop = maxTop > 0 ? payload.ratioY * maxTop : payload.scrollY;

      try {
        el.scrollTo({ left: targetLeft, top: targetTop, behavior: "instant" });
      } catch (_e) {
        el.scrollLeft = targetLeft;
        el.scrollTop = targetTop;
      }

      context.logger.debug(`scroll apply element key=${payload.targetKey} y=${targetTop}`);
      return;
    }

    const maxX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    const maxY = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const targetX = maxX > 0 ? payload.ratioX * maxX : payload.scrollX;
    const targetY = maxY > 0 ? payload.ratioY * maxY : payload.scrollY;

    try {
      window.scrollTo({ left: targetX, top: targetY, behavior: "instant" });
    } catch (_e) {
      window.scrollTo(targetX, targetY);
    }

    context.logger.debug(`scroll apply doc x=${targetX} y=${targetY}`);
  }
}
