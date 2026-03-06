function randomPart(): string {
  if (typeof crypto?.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function createId(prefix: string): string {
  return `${prefix}-${randomPart()}`;
}
