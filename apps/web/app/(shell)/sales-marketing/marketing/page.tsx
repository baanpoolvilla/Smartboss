import { requireAuth } from "@smartboss/auth";
import { ExternalAppList } from "../app-list";

export default async function MarketingAppsPage() {
  await requireAuth();
  return <ExternalAppList group="marketing" />;
}
