import { randomBytes } from "node:crypto";
import { localDateString } from "@/lib/local-date";

export function createItemCode() {
  const date = localDateString().replaceAll("-", "");
  return `INV-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}
