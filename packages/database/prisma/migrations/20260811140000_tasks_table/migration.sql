-- ย้ายงานในบอร์ด Kanban จากก้อน JSON ก้อนเดียว มาเป็นตารางจริงหนึ่งแถวต่อหนึ่งงาน
--
-- เดิม: report_task.stores แถวเดียว key='tasks' เก็บงานทั้งบริษัทเป็น array
--       ⇒ แก้ชื่องานตัวเดียวต้องเขียนทับทั้งก้อน และ query ฝั่งเซิร์ฟเวอร์ไม่ได้
--
-- ย้ายข้อมูลเดิมให้อัตโนมัติ พร้อมตั้งเลขที่ T-<ปีพ.ศ.>-<ลำดับ> ให้ตามวันที่สร้าง

CREATE TABLE "report_task"."tasks" (
    "org_id"         TEXT      NOT NULL,
    "id"             TEXT      NOT NULL,
    "code"           TEXT      NOT NULL,
    "title"          TEXT      NOT NULL,
    "status"         TEXT      NOT NULL,
    "priority"       TEXT      NOT NULL,
    "task_mode"      TEXT      NOT NULL,
    "assigned_by_id" TEXT      NOT NULL,
    "assignee_ids"   TEXT[]    NOT NULL,
    "parent_id"      TEXT,
    "start_date"     TEXT      NOT NULL,
    "due_date"       TEXT      NOT NULL,
    "completed_at"   TEXT,
    "data"           JSONB     NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tasks_pkey" PRIMARY KEY ("org_id","id")
);

CREATE UNIQUE INDEX "tasks_org_id_code_key" ON "report_task"."tasks"("org_id","code");
CREATE INDEX "tasks_org_id_status_idx"   ON "report_task"."tasks"("org_id","status");
CREATE INDEX "tasks_org_id_due_date_idx" ON "report_task"."tasks"("org_id","due_date");

ALTER TABLE "report_task"."tasks"
  ADD CONSTRAINT "tasks_org_id_fkey" FOREIGN KEY ("org_id")
  REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- เลขรุ่นของทั้งคอลเลกชัน — client ส่งงานมาทั้งชุดทุกครั้ง จึงต้องมีตัวกันเขียนทับ
CREATE TABLE "report_task"."task_collections" (
    "org_id"     TEXT NOT NULL,
    "version"    INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,
    CONSTRAINT "task_collections_pkey" PRIMARY KEY ("org_id")
);

ALTER TABLE "report_task"."task_collections"
  ADD CONSTRAINT "task_collections_org_id_fkey" FOREIGN KEY ("org_id")
  REFERENCES "core"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ย้ายข้อมูลเดิม ──────────────────────────────────────────────────────
-- แตก array ใน stores.data ออกเป็นแถว แล้วเรียงตาม createdAt เพื่อตั้งเลขที่
WITH src AS (
  SELECT s.org_id,
         t.value AS task,
         row_number() OVER (
           PARTITION BY s.org_id,
             COALESCE(substring(t.value->>'createdAt' FROM 1 FOR 4), '1970')
           ORDER BY t.value->>'createdAt', t.value->>'id'
         ) AS n,
         COALESCE(substring(t.value->>'createdAt' FROM 1 FOR 4), '1970')::int + 543 AS be_year
  FROM report_task.stores s
  CROSS JOIN LATERAL jsonb_array_elements(s.data) AS t(value)
  WHERE s.key = 'tasks' AND jsonb_typeof(s.data) = 'array'
)
INSERT INTO report_task.tasks (
  org_id, id, code, title, status, priority, task_mode, assigned_by_id,
  assignee_ids, parent_id, start_date, due_date, completed_at, data,
  created_at, updated_at
)
SELECT
  src.org_id,
  src.task->>'id',
  'T-' || src.be_year || '-' || lpad(src.n::text, 4, '0'),
  COALESCE(src.task->>'title', ''),
  COALESCE(src.task->>'status', 'todo'),
  COALESCE(src.task->>'priority', 'medium'),
  COALESCE(src.task->>'taskMode', 'individual'),
  COALESCE(src.task->>'assignedById', ''),
  COALESCE(
    ARRAY(SELECT jsonb_array_elements_text(src.task->'assigneeIds')),
    ARRAY[]::text[]
  ),
  src.task->>'parentId',
  COALESCE(src.task->>'startDate', ''),
  COALESCE(src.task->>'dueDate', ''),
  src.task->>'completedAt',
  src.task,
  COALESCE((src.task->>'createdAt')::timestamptz, now()),
  COALESCE((src.task->>'updatedAt')::timestamptz, now())
FROM src
ON CONFLICT ("org_id","id") DO NOTHING;

-- ตัวนับเลขที่งาน ให้เดินต่อจากของเดิมได้ถูก
INSERT INTO core.document_counters (org_id, doc_type, period, next_value)
SELECT org_id,
       'T',
       (EXTRACT(YEAR FROM created_at)::int + 543)::text,
       COUNT(*) + 1
FROM report_task.tasks
GROUP BY org_id, EXTRACT(YEAR FROM created_at)
ON CONFLICT ("org_id","doc_type","period") DO NOTHING;

-- ยกเลขรุ่นเดิมมาด้วย เพื่อไม่ให้แท็บที่เปิดค้างอยู่คิดว่าตัวเองยังใหม่กว่า
INSERT INTO report_task.task_collections (org_id, version, updated_at, updated_by)
SELECT org_id, version, updated_at, updated_by
FROM report_task.stores
WHERE key = 'tasks'
ON CONFLICT ("org_id") DO NOTHING;

-- แถวเดิมใน stores ไม่ลบทิ้งในรอบนี้ — เก็บไว้เป็นตาข่ายรับถ้าต้องย้อนกลับ
-- ลบได้ในรอบถัดไปเมื่อแน่ใจแล้ว:  DELETE FROM report_task.stores WHERE key = 'tasks';
