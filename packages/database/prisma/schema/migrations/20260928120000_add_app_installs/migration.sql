-- เครื่องที่ผู้ใช้เปิด SmartBoss จากแอปที่ติดตั้ง (PWA) — ตารางใหม่ ไม่แตะข้อมูลเดิม

-- CreateTable
CREATE TABLE "core"."app_installs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "user_agent" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_installs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_installs_org_id_idx" ON "core"."app_installs"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_installs_user_id_platform_key" ON "core"."app_installs"("user_id", "platform");
