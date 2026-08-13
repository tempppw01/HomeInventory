export const AUTH_COOKIE = "home_inventory_auth";

export async function authToken(password: string) {
  const data = new TextEncoder().encode(`home-inventory:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
