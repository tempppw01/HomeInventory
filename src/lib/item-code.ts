import { randomBytes } from "node:crypto";

export function createItemCode() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `INV-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}
