import { prisma } from "@smartboss/database";
import { dockOverdueMaintenance } from "@/modules/maintenance/data/cron";
(async () => { await dockOverdueMaintenance(); const n = await prisma.performanceEvent.count({ where: { category: "pm_missed", refId: { endsWith: process.argv[2]! } } }); console.log("DOCKS", n); process.exit(0); })();
