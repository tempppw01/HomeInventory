import { InventoryApp } from "@/components/inventory-app";
import { AuthGate } from "@/components/auth-gate";

export default function Home() {
  return <AuthGate><InventoryApp /></AuthGate>;
}
