import type { BrowserActionService } from "./action-service";
import { ClipboardActionService } from "./clipboard-action-service";
import { ClickActionService } from "./click-action-service";
import { CompositionActionService } from "./composition-action-service";
import { ContextMenuActionService } from "./context-menu-action-service";
import { DblClickActionService } from "./dblclick-action-service";
import { DragActionService } from "./drag-action-service";
import { FocusActionService } from "./focus-action-service";
import { FormResetActionService } from "./form-reset-action-service";
import { InputActionService } from "./input-action-service";
import { KeyboardActionService } from "./keyboard-action-service";
import { MouseDownActionService } from "./mouse-down-action-service";
import { MouseEnterLeaveActionService } from "./mouse-enter-leave-action-service";
import { NavigationActionService } from "./navigation-action-service";
import { MouseMoveActionService } from "./mouse-move-action-service";
import { MouseOutActionService } from "./mouse-out-action-service";
import { MouseOverActionService } from "./mouse-over-action-service";
import { MouseUpActionService } from "./mouse-up-action-service";
import { PointerActionService } from "./pointer-action-service";
import { ScrollActionService } from "./scroll-action-service";
import { SelectActionService } from "./select-action-service";
import { SubmitActionService } from "./submit-action-service";
import { TouchActionService } from "./touch-action-service";
import { WheelActionService } from "./wheel-action-service";

export function createActionServices(): BrowserActionService[] {
  return [
    new InputActionService(),
    new ClickActionService(),
    new DblClickActionService(),
    new ContextMenuActionService(),
    new MouseDownActionService(),
    new MouseUpActionService(),
    new MouseOverActionService(),
    new MouseOutActionService(),
    new MouseMoveActionService(),
    new MouseEnterLeaveActionService(),
    new PointerActionService(),
    new FocusActionService(),
    new SubmitActionService(),
    new FormResetActionService(),
    new KeyboardActionService(),
    new CompositionActionService(),
    new SelectActionService(),
    new ScrollActionService(),
    new WheelActionService(),
    new ClipboardActionService(),
    new TouchActionService(),
    new DragActionService(),
    new NavigationActionService(),
  ];
}
