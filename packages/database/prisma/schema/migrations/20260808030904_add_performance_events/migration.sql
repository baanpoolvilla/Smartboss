-- CreateTable
CREATE TABLE "core"."performance_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "points" DECIMAL(6,2) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "performance_events_org_id_user_id_occurred_at_idx" ON "core"."performance_events"("org_id", "user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "performance_events_org_id_occurred_at_idx" ON "core"."performance_events"("org_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "performance_events_org_id_source_category_ref_type_ref_id_key" ON "core"."performance_events"("org_id", "source", "category", "ref_type", "ref_id");

-- AddForeignKey
ALTER TABLE "core"."performance_events" ADD CONSTRAINT "performance_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."performance_events" ADD CONSTRAINT "performance_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "core"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
