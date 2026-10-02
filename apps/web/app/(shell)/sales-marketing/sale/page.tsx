import { requireAuth } from "@smartboss/auth";
import { ExternalAppList } from "../app-list";

export default async function SaleAppsPage() {
  await requireAuth();
  return <ExternalAppList group="sale" />;
}
