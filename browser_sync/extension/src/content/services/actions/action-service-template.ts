import type { BrowserActionEnvelope } from "../../types";
import type { ActionApplyContext, BrowserActionService } from "./action-service";

export abstract class BrowserActionServiceTemplate implements BrowserActionService {
  abstract readonly actionType: string;
  abstract readonly listenedEventTypes: readonly string[];
  readonly throttleMs?: number;

  abstract capture(event: Event): unknown | null;

  getMuteKey(_payload: unknown): string | null {
    return null;
  }

  abstract apply(action: BrowserActionEnvelope, context: ActionApplyContext): void;
}
