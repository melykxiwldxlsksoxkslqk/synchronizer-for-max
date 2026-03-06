import type { SyncScope } from "../types";

export function normalizeScope(raw: unknown): SyncScope | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const origin = typeof record.origin === "string" ? record.origin.trim() : "";
  const path = typeof record.path === "string" ? record.path.trim() : "";
  const formKey = typeof record.formKey === "string" && record.formKey.trim()
    ? record.formKey.trim()
    : "no-form";

  if (!origin || !path) return null;
  return { origin, path, formKey };
}
