import { DEBUG_LOG_ENABLED } from "./constants";
import { createActionServices } from "./services/actions/registry";
import { createLogger } from "./services/logger";
import { startSyncEngine } from "./services/sync-engine";

interface SyncWindowFlag extends Window {
  __BS_STORAGE_SYNC_INSTALLED__?: boolean;
}

export async function bootstrapContentScript(): Promise<void> {
  const win = window as SyncWindowFlag;
  const logger = createLogger("BS-EXT", DEBUG_LOG_ENABLED);
  if (win.__BS_STORAGE_SYNC_INSTALLED__) {
    logger.debug("bootstrap skipped: content script already installed");
    return;
  }
  win.__BS_STORAGE_SYNC_INSTALLED__ = true;
  logger.info("bootstrap start", {
    href: window.location.href,
    origin: window.location.origin,
    path: window.location.pathname,
    debug: DEBUG_LOG_ENABLED,
  });

  try {
    const services = createActionServices();
    await startSyncEngine({
      logger,
      actionServices: services,
    });
    logger.info("bootstrap completed", { services: services.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`bootstrap failed: ${message}`);
  }
}
