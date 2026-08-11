-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "maintenance";

-- AlterTable
ALTER TABLE "core"."users" ADD COLUMN     "line_user_id" TEXT;

-- CreateTable
CREATE TABLE "core"."notifications" (
    "id" TEXT NOT NULL,
    "org_id" TEXT,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "type" TEXT NOT NULL DEFAULT 'general',
    "reference_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."properties" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "owner_name" TEXT,
    "owner_contact" TEXT,
    "notes" TEXT,
    "caretaker_id" TEXT,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."property_categories" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."assets" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "install_date" DATE,
    "warranty_expiry" DATE,
    "notes" TEXT,
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."work_orders" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "assigned_to" TEXT,
    "created_by" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "due_date" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completion_notes" TEXT,
    "photo_urls" TEXT[],
    "after_photo_urls" TEXT[],
    "cc_user_ids" TEXT[],
    "additional_property_ids" TEXT[],
    "pm_schedule_id" TEXT,
    "pm_schedule_ids" TEXT[],
    "auto_created" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."work_order_comments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "user_id" TEXT,
    "content" TEXT NOT NULL,
    "image_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."work_order_external_photos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_external_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."work_order_upload_links" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "work_order_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_order_upload_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."expenses" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "pm_schedule_id" TEXT,
    "purchase_order_id" TEXT,
    "property_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "receipt_url" TEXT,
    "billable_to_partner" BOOLEAN NOT NULL DEFAULT false,
    "cost_type" TEXT NOT NULL DEFAULT 'work_order',
    "paid_by" TEXT NOT NULL DEFAULT 'company',
    "is_no_expense" BOOLEAN NOT NULL DEFAULT false,
    "expense_date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."pm_schedules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "property_id" TEXT NOT NULL,
    "asset_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'monthly',
    "next_due_date" DATE NOT NULL,
    "anchor_date" DATE,
    "rounds_per_year" INTEGER,
    "total_rounds" INTEGER,
    "rounds_done" INTEGER NOT NULL DEFAULT 0,
    "awaiting_schedule" BOOLEAN NOT NULL DEFAULT false,
    "last_completed_date" DATE,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_to" TEXT,
    "cc_user_ids" TEXT[],
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pm_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."contractors" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "specialty" TEXT,
    "company_name" TEXT,
    "notes" TEXT,
    "zone" TEXT,
    "rating" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "price" DECIMAL(12,2),
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."contractor_history" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "contractor_id" TEXT NOT NULL,
    "work_order_id" TEXT,
    "property_id" TEXT,
    "description" TEXT,
    "amount" DECIMAL(12,2),
    "work_date" DATE,
    "rating" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."purchase_orders" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "property_id" TEXT,
    "created_by" TEXT,
    "po_assigned_to" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "items" JSONB NOT NULL DEFAULT '[]',
    "total_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "receipt_image_url" TEXT,
    "receipt_image_urls" TEXT[],
    "is_self_purchase" BOOLEAN NOT NULL DEFAULT false,
    "is_emergency_purchase" BOOLEAN NOT NULL DEFAULT false,
    "emergency_reason" TEXT,
    "pr_image_urls" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."purchase_order_comments" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "user_id" TEXT,
    "content" TEXT NOT NULL,
    "image_urls" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance"."line_config" (
    "org_id" TEXT NOT NULL,
    "channel_access_token" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "line_config_pkey" PRIMARY KEY ("org_id")
);

-- CreateTable
CREATE TABLE "maintenance"."line_notification_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "line_user_id" TEXT,
    "message" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "core"."notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "properties_org_id_idx" ON "maintenance"."properties"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_categories_org_id_prefix_key" ON "maintenance"."property_categories"("org_id", "prefix");

-- CreateIndex
CREATE INDEX "assets_org_id_idx" ON "maintenance"."assets"("org_id");

-- CreateIndex
CREATE INDEX "assets_property_id_idx" ON "maintenance"."assets"("property_id");

-- CreateIndex
CREATE INDEX "work_orders_org_id_idx" ON "maintenance"."work_orders"("org_id");

-- CreateIndex
CREATE INDEX "work_orders_property_id_idx" ON "maintenance"."work_orders"("property_id");

-- CreateIndex
CREATE INDEX "work_orders_assigned_to_idx" ON "maintenance"."work_orders"("assigned_to");

-- CreateIndex
CREATE INDEX "work_orders_status_idx" ON "maintenance"."work_orders"("status");

-- CreateIndex
CREATE INDEX "work_order_comments_org_id_idx" ON "maintenance"."work_order_comments"("org_id");

-- CreateIndex
CREATE INDEX "work_order_comments_work_order_id_idx" ON "maintenance"."work_order_comments"("work_order_id");

-- CreateIndex
CREATE INDEX "work_order_external_photos_org_id_idx" ON "maintenance"."work_order_external_photos"("org_id");

-- CreateIndex
CREATE INDEX "work_order_external_photos_work_order_id_idx" ON "maintenance"."work_order_external_photos"("work_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_upload_links_token_key" ON "maintenance"."work_order_upload_links"("token");

-- CreateIndex
CREATE INDEX "work_order_upload_links_org_id_idx" ON "maintenance"."work_order_upload_links"("org_id");

-- CreateIndex
CREATE INDEX "work_order_upload_links_work_order_id_idx" ON "maintenance"."work_order_upload_links"("work_order_id");

-- CreateIndex
CREATE INDEX "expenses_org_id_idx" ON "maintenance"."expenses"("org_id");

-- CreateIndex
CREATE INDEX "expenses_work_order_id_idx" ON "maintenance"."expenses"("work_order_id");

-- CreateIndex
CREATE INDEX "expenses_property_id_idx" ON "maintenance"."expenses"("property_id");

-- CreateIndex
CREATE INDEX "pm_schedules_org_id_idx" ON "maintenance"."pm_schedules"("org_id");

-- CreateIndex
CREATE INDEX "pm_schedules_property_id_idx" ON "maintenance"."pm_schedules"("property_id");

-- CreateIndex
CREATE INDEX "pm_schedules_next_due_date_idx" ON "maintenance"."pm_schedules"("next_due_date");

-- CreateIndex
CREATE INDEX "contractors_org_id_idx" ON "maintenance"."contractors"("org_id");

-- CreateIndex
CREATE INDEX "contractor_history_org_id_idx" ON "maintenance"."contractor_history"("org_id");

-- CreateIndex
CREATE INDEX "contractor_history_contractor_id_idx" ON "maintenance"."contractor_history"("contractor_id");

-- CreateIndex
CREATE INDEX "purchase_orders_org_id_idx" ON "maintenance"."purchase_orders"("org_id");

-- CreateIndex
CREATE INDEX "purchase_orders_status_idx" ON "maintenance"."purchase_orders"("status");

-- CreateIndex
CREATE INDEX "purchase_order_comments_org_id_idx" ON "maintenance"."purchase_order_comments"("org_id");

-- CreateIndex
CREATE INDEX "purchase_order_comments_purchase_order_id_idx" ON "maintenance"."purchase_order_comments"("purchase_order_id");

-- CreateIndex
CREATE INDEX "line_notification_logs_org_id_created_at_idx" ON "maintenance"."line_notification_logs"("org_id", "created_at");

-- AddForeignKey
ALTER TABLE "maintenance"."assets" ADD CONSTRAINT "assets_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "maintenance"."properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."work_orders" ADD CONSTRAINT "work_orders_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "maintenance"."properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."work_orders" ADD CONSTRAINT "work_orders_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "maintenance"."assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."work_order_comments" ADD CONSTRAINT "work_order_comments_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "maintenance"."work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."work_order_external_photos" ADD CONSTRAINT "work_order_external_photos_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "maintenance"."work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."work_order_upload_links" ADD CONSTRAINT "work_order_upload_links_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "maintenance"."work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."pm_schedules" ADD CONSTRAINT "pm_schedules_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "maintenance"."properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."pm_schedules" ADD CONSTRAINT "pm_schedules_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "maintenance"."assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."contractor_history" ADD CONSTRAINT "contractor_history_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "maintenance"."contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance"."purchase_order_comments" ADD CONSTRAINT "purchase_order_comments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "maintenance"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
