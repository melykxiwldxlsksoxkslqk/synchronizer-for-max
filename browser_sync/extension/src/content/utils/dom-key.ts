import type { SyncScope } from "../types";

const DYNAMIC_ID_PATTERNS: RegExp[] = [
  /^:r[0-9a-z]+:$/i,
  /^:[\w.-]+:$/,
  /^[a-f0-9]{8,}$/i,
  /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}/i,
  /^(headlessui|radix|mui|cdk|rc|downshift|reach)-/i,
  /^(el|rc|comp|node|widget|ember|vue|svelte)[-_]?\d+$/i,
  /^react-select[-_]/i,
  /[-_][a-f0-9]{8,}$/i,
  /^_[a-zA-Z0-9_]{15,}$/,
  /^[a-zA-Z0-9_]{20,}$/,
];

function isDynamicId(id: string): boolean {
  if (!id) return true;
  if (id.length > 128) return true;
  return DYNAMIC_ID_PATTERNS.some((p) => p.test(id));
}

function cssPath(node: HTMLElement): string {
  const parts: string[] = [];
  let current: HTMLElement | null = node;

  while (current && current.nodeType === 1 && current !== document.documentElement) {
    const tag = (current.nodeName || "").toLowerCase();
    if (!tag) break;

    if (current.id && !isDynamicId(current.id)) {
      parts.unshift(`${tag}#${current.id}`);
      break;
    }

    let siblingIndex = 1;
    let previousSibling: Element | null = current;
    while ((previousSibling = previousSibling.previousElementSibling)) {
      if ((previousSibling.nodeName || "").toLowerCase() === tag) {
        siblingIndex += 1;
      }
    }
    parts.unshift(`${tag}:nth-of-type(${siblingIndex})`);
    current = current.parentElement;

    if (parts.length > 8) break;
  }

  return parts.join(">");
}

function escSelector(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function getFormKey(element: HTMLElement): string {
  const form = element.closest("form");
  if (!form) {
    return "no-form";
  }

  const formElement = form as HTMLFormElement;
  if (formElement.id && !isDynamicId(formElement.id)) {
    return `id:${formElement.id}`;
  }

  const name = formElement.getAttribute("name");
  if (name) {
    return `name:${name}`;
  }

  const dataId =
    formElement.getAttribute("data-testid")
    || formElement.getAttribute("data-test")
    || formElement.getAttribute("data-qa")
    || formElement.getAttribute("data-cy");

  if (dataId) {
    return `data:${dataId}`;
  }

  return `css:${cssPath(formElement)}`;
}

export function buildScopeForElement(element: HTMLElement): SyncScope {
  return {
    origin: window.location.origin,
    path: window.location.pathname,
    formKey: getFormKey(element),
  };
}

function isStableKey(fieldKey: string): boolean {
  return fieldKey.startsWith("name:")
    || fieldKey.startsWith("ng:")
    || fieldKey.startsWith("data:")
    || fieldKey.startsWith("aria:")
    || fieldKey.startsWith("title:")
    || fieldKey.startsWith("placeholder:");
}

export function isScopeCompatible(
  scope: SyncScope | undefined,
  element: HTMLElement | null,
  fieldKey?: string,
): boolean {
  if (!scope) return false;

  if (scope.origin !== window.location.origin) return false;

  if (fieldKey && isStableKey(fieldKey)) {
    return true;
  }

  if (scope.path !== window.location.pathname) return false;

  return true;
}

export function keyOf(element: HTMLElement): string {
  if (element.id && !isDynamicId(element.id)) return `id:${element.id}`;

  const name = element.getAttribute("name");
  if (name) return `name:${name}`;

  const ngName = element.getAttribute("formcontrolname") || element.getAttribute("ng-reflect-name");
  if (ngName) return `ng:${ngName}`;

  const dataId =
    element.getAttribute("data-testid")
    || element.getAttribute("data-test")
    || element.getAttribute("data-qa")
    || element.getAttribute("data-cy");
  if (dataId) return `data:${dataId}`;

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return `aria:${ariaLabel}`;

  const title = element.getAttribute("title");
  if (title) return `title:${title}`;

  const placeholder = element.getAttribute("placeholder");
  if (placeholder) return `placeholder:${placeholder}`;

  const role = element.getAttribute("role");
  const text = element.textContent?.trim().slice(0, 50);
  if (role && text) return `role:${role}:${text}`;

  const path = cssPath(element);
  return path ? `css:${path}` : "";
}

export function getFormKeyFromForm(form: HTMLFormElement): string {
  if (form.id && !isDynamicId(form.id)) return `id:${form.id}`;
  const name = form.getAttribute("name");
  if (name) return `name:${name}`;
  const dataId =
    form.getAttribute("data-testid")
    || form.getAttribute("data-test")
    || form.getAttribute("data-qa")
    || form.getAttribute("data-cy");
  if (dataId) return `data:${dataId}`;
  return `css:${cssPath(form)}`;
}

export function findFormByKey(formKey: string): HTMLFormElement | null {
  if (!formKey) return null;
  try {
    if (formKey.startsWith("id:")) {
      const el = document.getElementById(formKey.slice(3));
      return el instanceof HTMLFormElement ? el : null;
    }
    if (formKey.startsWith("name:")) {
      const el = document.querySelector<HTMLFormElement>(`form[name="${escSelector(formKey.slice(5))}"]`);
      return el || null;
    }
    if (formKey.startsWith("data:")) {
      const v = escSelector(formKey.slice(5));
      return document.querySelector<HTMLFormElement>(
        `form[data-testid="${v}"],form[data-test="${v}"],form[data-qa="${v}"],form[data-cy="${v}"]`,
      );
    }
    if (formKey.startsWith("css:")) {
      const form = document.querySelector(formKey.slice(4));
      return form instanceof HTMLFormElement ? form : null;
    }
  } catch (_error) {
    return null;
  }
  return null;
}

export function findElementByKey(fieldKey: string): HTMLElement | null {
  if (!fieldKey) return null;

  try {
    if (fieldKey.startsWith("id:")) {
      return document.getElementById(fieldKey.slice(3));
    }
    if (fieldKey.startsWith("name:")) {
      return document.querySelector<HTMLElement>(`[name="${escSelector(fieldKey.slice(5))}"]`);
    }
    if (fieldKey.startsWith("ng:")) {
      const ng = escSelector(fieldKey.slice(3));
      return document.querySelector<HTMLElement>(`[formcontrolname="${ng}"],[ng-reflect-name="${ng}"]`);
    }
    if (fieldKey.startsWith("data:")) {
      const value = escSelector(fieldKey.slice(5));
      return document.querySelector<HTMLElement>(
        `[data-testid="${value}"],[data-test="${value}"],[data-qa="${value}"],[data-cy="${value}"]`,
      );
    }
    if (fieldKey.startsWith("aria:")) {
      return document.querySelector<HTMLElement>(`[aria-label="${escSelector(fieldKey.slice(5))}"]`);
    }
    if (fieldKey.startsWith("title:")) {
      return document.querySelector<HTMLElement>(`[title="${escSelector(fieldKey.slice(6))}"]`);
    }
    if (fieldKey.startsWith("placeholder:")) {
      return document.querySelector<HTMLElement>(`[placeholder="${escSelector(fieldKey.slice(12))}"]`);
    }
    if (fieldKey.startsWith("role:")) {
      const colonIdx = fieldKey.indexOf(":", 5);
      if (colonIdx > 5) {
        const role = escSelector(fieldKey.slice(5, colonIdx));
        return document.querySelector<HTMLElement>(`[role="${role}"]`);
      }
    }
    if (fieldKey.startsWith("css:")) {
      const selector = fieldKey.slice(4);
      if (!selector) return null;
      return document.querySelector<HTMLElement>(selector);
    }
  } catch (_error) {
    return null;
  }

  return null;
}
