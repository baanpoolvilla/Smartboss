-- โทรในแชท — เพิ่มตารางใหม่อย่างเดียว ไม่แตะข้อมูลเดิม

-- CreateTable
CREATE TABLE "chat"."calls" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "caller_id" TEXT NOT NULL,
    "callee_id" TEXT NOT NULL,
    "media" TEXT NOT NULL DEFAULT 'audio',
    "status" TEXT NOT NULL DEFAULT 'ringing',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "ended_by" TEXT,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calls_org_id_created_at_idx" ON "chat"."calls"("org_id", "created_at");
CREATE INDEX "calls_callee_id_status_idx" ON "chat"."calls"("callee_id", "status");
CREATE INDEX "calls_caller_id_status_idx" ON "chat"."calls"("caller_id", "status");
