-- ค่าคอม Pool รายเดือน แบ่งตามเกรดผลงาน — ตัวคูณต่อเกรดรายบริษัท + ยอด Pool ต่อเดือน

-- CreateTable
CREATE TABLE "core"."commission_settings" (
    "org_id" TEXT NOT NULL,
    "grade_weights" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "commission_settings_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "core"."commission_pools" (
    "org_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "commission_pools_pkey" PRIMARY KEY ("org_id","month")
);

-- AddForeignKey
ALTER TABLE "core"."commission_settings" ADD CONSTRAINT "commission_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."commission_pools" ADD CONSTRAINT "commission_pools_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
