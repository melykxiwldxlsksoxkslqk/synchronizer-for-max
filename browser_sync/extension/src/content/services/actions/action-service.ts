import type { BrowserActionEnvelope, BrowserActionType } from "../../types";
import type { Logger } from "../logger";

export interface ActionApplyContext {
  logger: Logger;
  markMutedField: (fieldKey: string, durationMs?: number) => void;
}

export interface BrowserActionService {
  readonly actionType: BrowserActionType;
  readonly listenedEventTypes: readonly string[];
  readonly throttleMs?: number;

  capture(event: Event): unknown | null;
  getMuteKey(payload: unknown): string | null;
  apply(action: BrowserActionEnvelope, context: ActionApplyContext): void;
}
