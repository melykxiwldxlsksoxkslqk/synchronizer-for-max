import type { BrowserActionEnvelope, NavigationActionPayload } from "../../types";
import { normalizeScope } from "../../utils/normalize-scope";
import type { ActionApplyContext } from "./action-service";
import { BrowserActionServiceTemplate } from "./action-service-template";
import { ACTION_TYPES } from "./action-types";

function normalizeNavigationPayload(raw: unknown): NavigationActionPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const url = typeof r.url === "string" ? r.url.trim() : "";
  if (!url) return null;

  const scope = normalizeScope(r.scope);
  if (!scope) return null;

  return { url, scope };
}

export class NavigationActionService extends BrowserActionServiceTemplate {
  readonly actionType = ACTION_TYPES.navigation;
  readonly listenedEventTypes = ["popstate", "hashchange"] as const;

  private lastKnownUrl = "";

  capture(_event: Event): NavigationActionPayload | null {
    const currentUrl = window.location.href;
    if (currentUrl === this.lastKnownUrl) return null;
    this.lastKnownUrl = currentUrl;

    return {
      url: currentUrl,
      scope: {
        origin: window.location.origin,
        path: window.location.pathname,
        formKey: "no-form",
      },
    };
  }

  getMuteKey(_payload: unknown): string | null {
    return "__navigation__";
  }

  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void {
    try { if (window.top !== window) return; } catch (_e) { return; }

    const payload = normalizeNavigationPayload(action.payload);
    if (!payload) return;

    if (payload.scope.origin !== window.location.origin) {
      context.logger.debug("navigation apply: different origin, skipping");
      return;
    }

    if (payload.url === window.location.href) {
      context.logger.debug("navigation apply: already on this URL");
      return;
    }

    context.markMutedField("__navigation__", 2000);

    context.logger.info(`navigation apply: navigating to ${payload.url}`);
    try {
      const chromeApi = (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: (msg: unknown) => void } } }).chrome;
      chromeApi?.runtime?.sendMessage?.({
        type: "__bs_navigate_tab__",
        url: payload.url,
      });
    } catch (_error) { /* no-op */ }
  }
}
