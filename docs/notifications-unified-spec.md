# สเปค: รวมศูนย์ระบบแจ้งเตือน (Unified Notifications)

ต่อยอดจาก commit `07126da` + งานค้าง 5 ไฟล์ (redirect, isRoomPost, bell popover)
เป้าหมายรอบนี้ตามที่เจ้าของงานสั่ง:

1. **รวมแจ้งเตือนทุกแหล่งไว้ที่เดียว** — ทั้ง report_task (รายงาน/งาน/แชท) และ maintenance (งานซ่อมบำรุง) แสดงรวมกันทั้งใน dropdown กระดิ่งและหน้า `/notifications`
2. **ยังไม่อ่านขึ้นบนสุดเสมอ** (unread-first) แล้วตามด้วยใหม่→เก่า
3. dropdown กดดูรายการได้เลย ไม่ต้องเด้งไปหน้าใหญ่ (ทำแล้ว) — ปุ่ม "ดูทั้งหมด" ค่อยไปหน้าเต็ม
4. **หน้าเต็มมีฟิลเตอร์ครบ**: สถานะ (ทั้งหมด/ยังไม่อ่าน), ตามประเภท, ตามห้อง/ช่อง, ช่วงเวลา (วันนี้/7 วัน/เดือนนี้/ทั้งหมด), แยกตาม module
5. **เคารพสิทธิ์**: ทุกคนเห็นเฉพาะแจ้งเตือนที่ส่งถึงตัวเอง (เป็นอยู่แล้ว). โหมด "ภาพรวมทั้งหมด" (เห็นของคนอื่น) = **CEO/owner เท่านั้น** (`isOwner`)

---

## แหล่งข้อมูล 2 แหล่ง (สำคัญ)

- **report_task** — client zustand `useNotificationStore` (server-synced apiKey "notifications").
  ฟิลด์: `id, userId, message, byUserId, createdAt, read, topicName?, link?, kind?`
- **maintenance** — Prisma `core.notifications` ฝั่ง server. helper อยู่ที่ `apps/web/modules/maintenance/data/notify.ts`
  (`listNotifications(userId)`, `unreadCount`, `markAllRead`). ฟิลด์: `id, title, body, type, referenceId, createdAt, readAt`.
  หน้า `/notifications` เดิม map type→ไอคอน/ลิงก์ผ่าน `hrefFor()` ใน `app/(shell)/notifications/page.tsx`

เพื่อรวม 2 แหล่งฝั่ง client ต้องเปิด API ให้ดึง maintenance มา แล้ว normalize เป็นชนิดกลาง

---

## โมเดลกลาง (UnifiedNotification)

สร้าง `apps/web/modules/notifications/types.ts`:

```ts
export type NotifModule = "report" | "maintenance";
export type NotifCategory =
  | "report_post" | "reply" | "mention" | "reaction"
  | "task" | "meeting" | "ticket" | "report_reminder"
  | "work_order" | "pm" | "expense" | "purchase_order" | "general";

export interface UnifiedNotification {
  id: string;               // ใส่ prefix กันชนกัน: `rt:${id}` / `mt:${id}`
  module: NotifModule;
  category: NotifCategory;
  message: string;          // report ใช้ message ตรง ๆ; maintenance ใช้ title (+ body ย่อ)
  body?: string | null;     // maintenance เท่านั้น
  byUserId?: string;        // report เท่านั้น (ไว้โชว์ avatar)
  roomName?: string;        // report: topicName; maintenance: undefined
  createdAt: string;        // ISO
  read: boolean;
  link?: string | null;
}
```

หมายเหตุ category:
- report: map จาก `kind`/รูปแบบข้อความ (มี `actionMetaFor`/`isRoomPost` ที่ export แล้วใน `report-notification-list.tsx` ใช้ต่อได้ — ควรย้าย logic เดา category มาไว้ที่ `modules/notifications/derive.ts` แล้วให้ทั้ง list เดิม + unified เรียกใช้ ไม่ให้ซ้ำ)
- maintenance: ใช้ `type` (work_order/pm/expense/purchase_order/general) ตรง ๆ

---

## งานที่ต้องทำ (ไล่ตามลำดับ)

### 1) เปิด API ให้ maintenance ดึงฝั่ง client
- เพิ่มใน `modules/maintenance/data/notify.ts`:
  ```ts
  export async function markRead(userId: string, id: string) {
    await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  }
  ```
- สร้าง `app/api/notifications/maintenance/route.ts`:
  - `GET` → `requireAuth()` แล้วคืน `listNotifications(session.userId)` เป็น JSON (id,title,body,type,referenceId,createdAt,readAt)
  - `POST` body `{ id?: string }` → มี id = `markRead(userId,id)`, ไม่มี = `markAllRead(userId)` ; คืน `{ ok: true }`
  - **สิทธิ์**: query ผูก `userId` จาก session เท่านั้น ห้ามรับ userId จาก client

### 2) client store/hook สำหรับ maintenance
สร้าง `modules/notifications/use-maintenance-notifications.ts` (zustand เล็ก ๆ):
- state: `items: MaintenanceNotif[]`, `loaded: boolean`
- `refresh()` → fetch GET, set items
- `markRead(id)` / `markAllRead()` → optimistic update + POST
- เรียก `refresh()` ครั้งแรกตอน mount (ใน bell popover + หน้า /notifications) และ refresh เมื่อเปิด dropdown

### 3) ตัวรวม + จัดเรียง
สร้าง `modules/notifications/use-unified-notifications.ts`:
- รวม report_task (จาก `useNotificationStore`, กรอง `userId === viewingAsUserId`, ตัด room_post ด้วย `isRoomPost` **เว้นแต่** owner เปิดโหมดภาพรวม) + maintenance (จาก hook ข้อ 2) → normalize เป็น `UnifiedNotification[]`
- **จัดเรียง unread-first**: `sort((a,b) => Number(a.read) - Number(b.read) || b.createdAt.localeCompare(a.createdAt))`
- คืน `{ items, unreadCount, markRead(id), markAllRead(), refresh() }` โดย markRead แยก routing ตาม prefix (`rt:`/`mt:`) ไปเรียก store ที่ถูกแหล่ง

### 4) dropdown กระดิ่ง (แก้ `notification-bell-popover.tsx`)
- ใช้ `use-unified-notifications` แทนการอ่าน store ตรง
- โชว์ unread-first, top 10, รวมทุก module (ไอคอน/สี: report ใช้ `actionMetaFor`, maintenance ใช้ไอคอนตาม type — work_order=ClipboardList/#2196F3, pm=CalendarClock/#FF9800, expense/purchase_order=ReceiptText/#4CAF50, general=Bell)
- maintenance ไม่มี avatar คน → ใช้วงกลมไอคอนสีตาม type (เหมือนหน้าเดิม) แทน avatar
- badge = unreadCount รวมทุก module (เลิกใช้ extraUnread แล้ว เพราะรวมจริง)
- กดรายการ → markRead(id) + ปิด popup + ไปตาม link

### 5) หน้าเต็ม `/notifications` — รื้อเป็น unified + ฟิลเตอร์
- เปลี่ยน `app/(shell)/notifications/page.tsx` ให้ render client component ใหม่ `NotificationsPageClient` (ตัด 2 section แยกเดิมออก รวมเป็นลิสต์เดียว)
- แถบฟิลเตอร์ (sticky บนสุด):
  - **สถานะ**: ทั้งหมด / ยังไม่อ่าน
  - **module**: ทั้งหมด / รายงาน-งาน / ซ่อมบำรุง (ขยายได้ในอนาคต)
  - **ประเภท**: ตาม category (แสดงเฉพาะ category ที่มีจริงในลิสต์)
  - **ห้อง/ช่อง**: dropdown จาก roomName ที่มีจริง (report เท่านั้น)
  - **ช่วงเวลา**: วันนี้ / 7 วัน / เดือนนี้ / ทั้งหมด
  - ปุ่ม "ล้างฟิลเตอร์"
- **โหมดภาพรวม (owner เท่านั้น)**: ปุ่มสลับ เฉพาะฉัน/ภาพรวมทั้งหมด (คงของเดิม) — โหมดภาพรวมให้ unified รวม room_post + (ออปชัน) แจ้งเตือน report_task ของคนอื่นทั้งองค์กร
  - **สิทธิ์**: ถ้าไม่ใช่ owner ห้ามให้เข้าโหมดภาพรวมเด็ดขาด (เช็ค `isOwner(viewingAsUserId)` ทั้งฝั่ง render และตอนกรอง)
- จัดเรียง unread-first เสมอ; หัวข้อกลุ่ม "ใหม่ / ก่อนหน้านี้" ยังใช้ได้
- ปุ่ม "อ่านทั้งหมด" → markAllRead ทั้ง 2 แหล่ง

### 6) กันซ้ำ / เก็บกวาด
- ย้าย `actionMetaFor` + `isRoomPost` + logic เดา category ไปไว้ `modules/notifications/derive.ts` ให้ทั้ง `report-notification-list.tsx`, popover, unified ใช้ร่วม (ตอนนี้ export จาก list อยู่ ใช้ชั่วคราวได้แต่ควรย้าย)
- `useReportTaskUnreadCount` เดิม: unified เข้ามาแทนแล้ว ปล่อยไว้หรือปรับให้ dropdown/หน้าเต็มใช้ unified ตัวเดียว

---

## เช็คก่อน deploy
- `pnpm --filter web typecheck && pnpm --filter web build` ผ่าน
- ทดสอบด้วย user ธรรมดา (ไม่ใช่ owner): ต้องไม่เห็นปุ่มภาพรวม + ไม่เห็นของคนอื่น/ข้ามแผนก
- ทดสอบ owner: สลับภาพรวมได้, เห็น room_post
- dropdown: รวมซ่อมบำรุง + report, unread อยู่บน, กดแล้วเข้าถูกหน้า ไม่ 404
- ฟิลเตอร์ทุกตัวกรองถูก, ช่วงเวลาอิง timezone Asia/Bangkok
