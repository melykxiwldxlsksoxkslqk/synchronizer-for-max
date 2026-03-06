export type BrowserActionType = string;
export type ActionSourceKind = "user" | "simulation";

export interface SyncScope {
  origin: string;
  path: string;
  formKey: string;
}

export interface InputActionPayload {
  fieldKey: string;
  value: string;
  checked?: boolean;
  tag?: string;
  inputType?: string;
  isContentEditable?: boolean;
  scope: SyncScope;
}

export interface ClickActionPayload {
  fieldKey: string;
  scope: SyncScope;
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface NavigationActionPayload {
  url: string;
  scope: SyncScope;
}

export interface MouseDownActionPayload {
  fieldKey: string;
  scope: SyncScope;
  button: number;
  clientX: number;
  clientY: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface MouseUpActionPayload {
  fieldKey: string;
  scope: SyncScope;
  button: number;
  clientX: number;
  clientY: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface MouseOverActionPayload {
  fieldKey: string;
  scope: SyncScope;
  clientX: number;
  clientY: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  relatedTargetKey?: string;
}

export interface MouseOutActionPayload {
  fieldKey: string;
  scope: SyncScope;
  clientX: number;
  clientY: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  relatedTargetKey?: string;
}

export interface MouseMoveActionPayload {
  fieldKey: string;
  scope: SyncScope;
  clientX: number;
  clientY: number;
  movementX: number;
  movementY: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface DblClickActionPayload {
  fieldKey: string;
  scope: SyncScope;
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface ContextMenuActionPayload {
  fieldKey: string;
  scope: SyncScope;
  button: number;
  clientX: number;
  clientY: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface FocusActionPayload {
  fieldKey: string;
  scope: SyncScope;
  eventType: "focus" | "blur";
}

export interface SubmitActionPayload {
  formKey: string;
  scope: SyncScope;
}

export interface KeyboardActionPayload {
  fieldKey: string;
  scope: SyncScope;
  eventType: "keydown" | "keyup" | "keypress";
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat: boolean;
}

export interface SelectActionPayload {
  fieldKey: string;
  scope: SyncScope;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: string;
}

export interface ScrollActionPayload {
  scope: SyncScope;
  scrollX: number;
  scrollY: number;
  ratioX: number;
  ratioY: number;
  targetKey?: string;
}

export interface ClipboardActionPayload {
  fieldKey: string;
  scope: SyncScope;
  eventType: "copy" | "cut" | "paste";
}

export interface TouchActionPayload {
  fieldKey: string;
  scope: SyncScope;
  eventType: "touchstart" | "touchend" | "touchmove" | "touchcancel";
  touchCount: number;
  primaryTouchX: number;
  primaryTouchY: number;
}

export interface DragActionPayload {
  fieldKey: string;
  scope: SyncScope;
  eventType: "dragstart" | "dragend" | "drop" | "drag" | "dragenter" | "dragleave" | "dragover";
}

export interface WheelActionPayload {
  scope: SyncScope;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  targetKey?: string;
}

export interface PointerActionPayload {
  fieldKey: string;
  scope: SyncScope;
  eventType: "pointerdown" | "pointerup" | "pointermove" | "pointerover" | "pointerout" | "pointerenter" | "pointerleave" | "pointercancel";
  pointerId: number;
  width: number;
  height: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface CompositionActionPayload {
  fieldKey: string;
  scope: SyncScope;
  eventType: "compositionstart" | "compositionupdate" | "compositionend";
  data: string;
}

export interface FormResetPayload {
  formKey: string;
  scope: SyncScope;
}

export interface MouseEnterLeaveActionPayload {
  fieldKey: string;
  scope: SyncScope;
  eventType: "mouseenter" | "mouseleave";
  clientX: number;
  clientY: number;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  relatedTargetKey?: string;
}

export interface BrowserActionEnvelope<TPayload = unknown> {
  actionId: string;
  actionType: BrowserActionType;
  sessionId: string;
  sourceApplicationId: string;
  sourceKind: ActionSourceKind;
  timestampMs: number;
  payload: TPayload;
}

export interface SyncConfig {
  enabled: boolean;
  sessionId: string;
}
