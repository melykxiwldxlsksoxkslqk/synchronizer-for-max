import type { SyncConfig } from "./types";

export const STORAGE_KEYS = {
  config: "__bs_sync_config_v1__",
  actionBus: "__bs_action_bus_v1__",
} as const;

export const LEGACY_KEYS = {
  roomId: "__bs_room_id",
  enabled: "__bs_sync_enabled",
} as const;

export const DEFAULT_SYNC_CONFIG: SyncConfig = {
  enabled: true,
  sessionId: "default-session",
};

export const DEBUG_LOG_ENABLED = true;
export const DEFAULT_MUTE_WINDOW_MS = 180;
export const SEEN_ACTION_TTL_MS = 120_000;
