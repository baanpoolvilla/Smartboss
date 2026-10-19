import "server-only";
import { prisma } from "@smartboss/database";
import { listStoredFiles, type StoredObject } from "@/lib/storage";
import { readStore } from "@/modules/report_task/lib/db/org-store";

/**
 * พื้นที่ไฟล์ของบริษัทหนึ่ง แยกตามระบบ — หน้า /admin/storage/[orgId]
 * ("แยกให้ชัดว่าของอะไร ระบบไหน ข้อมูลเต็มจะได้รู้มาจากตรงไหนและเคลียได้ง่าย" 19/10/2569)
 *
 * นับจากไฟล์ที่อยู่ใน storage จริง (ไม่ใช่ตัวเลขในฐานข้อมูล) — ทุกระบบเก็บใต้
 * `<orgId>/<ระบบ>/...` (putFile) ยกเว้นของเก่า 2 แบบที่ไม่มี orgId นำหน้า:
 * `maintenance/purchase-orders` (ใบเสร็จ PO รุ่นแรก) และ `maintenance/external/<token>`
 * (รูปจากช่างภายนอก) — สองอันนี้นับเป็นของบริษัทนี้ก็ต่อเมื่อมีแถวของบริษัทนี้อ้างถึง
 *
 * อ่านอย่างเดียว ไม่ลบอะไร — การเคลียร์ทำที่ต้นทาง (โพสต์/ใบงาน/แชท/ไฟล์บริษัท)
 * เพื่อไม่ให้รูปในโพสต์เก่าหายไปเงียบ ๆ (ผู้ใช้เลือก "ลบที่ต้นทางเท่านั้น")
 */

export interface FileSource {
  /** อยู่ที่ไหน เช่น "โพสต์ #daily-report · Daily Report 19/10" */
  label: string;
  /** ลิงก์ไปที่ต้นทาง (ไปลบที่นั่น) — null = ไม่มีหน้าให้ไป */
  href: string | null;
}

export interface CategoryFile {
  key: string;
  size: number;
  lastModified: Date | null;
  source: FileSource | null;
}

export interface StorageCategory {
  id: string;
  system: string;
  label: string;
  /** ลบ/เคลียร์ได้ที่ไหน — บอกผู้ดูแลตรง ๆ */
  howToClear: string;
  bytes: number;
  count: number;
  /** ไฟล์ที่หาที่ใช้ไม่เจอ (กำพร้า) — null = หมวดนี้ตรวจไม่ได้ครบ */
  orphanBytes: number | null;
  orphanCount: number | null;
  largest: CategoryFile[];
}

interface CategoryDef {
  id: string;
  system: string;
  label: string;
  howToClear: string;
  /** path หลัง `<orgId>/` (หรือ path เต็มของ key เก่าที่ไม่มี orgId) */
  match: (rest: string) => boolean;
  /** ตรวจไฟล์กำพร้าได้ (มีดัชนีที่อ้างถึงครบทุกแถว) */
  orphanCheck: boolean;
}

/** เรียงตามที่แสดง — ตัวแรกที่ match ชนะ (ของเฉพาะเจาะจงต้องมาก่อนของกว้าง) */
const CATEGORIES: CategoryDef[] = [
  { id: "report", system: "รีพอร์ต & งาน", label: "รูป/ไฟล์แนบในโพสต์รีพอร์ตและงาน", howToClear: "ลบรูป/ไฟล์ในโพสต์หรือในงานนั้น", match: (r) => r.startsWith("report-task/"), orphanCheck: true },
  { id: "chat-stickers", system: "แชท", label: "สติกเกอร์", howToClear: "ลบสติกเกอร์ในชุดสติกเกอร์ของแชท", match: (r) => r.startsWith("chat/stickers/"), orphanCheck: false },
  { id: "chat", system: "แชท", label: "รูป/วิดีโอ/ไฟล์ที่ส่งในแชท", howToClear: "ยกเลิกข้อความในห้องแชทนั้น (รูป/วิดีโอหมดอายุตามระยะเก็บของแชทด้วย)", match: (r) => r.startsWith("chat/"), orphanCheck: false },
  { id: "chat-avatars", system: "แชท", label: "รูปกลุ่มแชท", howToClear: "เปลี่ยนรูปกลุ่ม", match: (r) => r.startsWith("chat-avatars/"), orphanCheck: false },
  { id: "company-files", system: "ไฟล์บริษัท", label: "ไฟล์ในคลังไฟล์บริษัท (ทุกเวอร์ชัน + ถังขยะ)", howToClear: "ลบไฟล์ แล้วล้างถังขยะในเมนูไฟล์บริษัท", match: (r) => r.startsWith("company-files/"), orphanCheck: true },
  { id: "wo-photos", system: "ซ่อมบำรุง", label: "รูปใบงาน (ก่อน/หลังซ่อม)", howToClear: "ลบใบงาน", match: (r) => r.startsWith("maintenance/work-orders/"), orphanCheck: true },
  { id: "wo-comments", system: "ซ่อมบำรุง", label: "รูปในความคิดเห็นใบงาน", howToClear: "ลบความคิดเห็นในใบงาน", match: (r) => r.startsWith("maintenance/comments/"), orphanCheck: true },
  { id: "wo-external", system: "ซ่อมบำรุง", label: "รูปจากช่างภายนอก (ลิงก์ส่งรูป)", howToClear: "ลบใบงาน", match: (r) => r.startsWith("maintenance/external/"), orphanCheck: true },
  { id: "po", system: "ซ่อมบำรุง", label: "รูป PR/PO และใบเสร็จ", howToClear: "แก้/ลบ PR-PO นั้น", match: (r) => r.startsWith("maintenance/purchase-orders/"), orphanCheck: true },
  { id: "returns", system: "ซ่อมบำรุง", label: "รูปคืนของ/เคลม", howToClear: "ลบรายการคืนของ", match: (r) => r.startsWith("maintenance/returns/"), orphanCheck: true },
  { id: "receipts", system: "ซ่อมบำรุง", label: "ใบเสร็จค่าใช้จ่าย", howToClear: "ลบรายการค่าใช้จ่าย", match: (r) => r.startsWith("maintenance/receipts/"), orphanCheck: true },
  { id: "assets", system: "ซ่อมบำรุง", label: "รูปอุปกรณ์", howToClear: "เปลี่ยน/ลบรูปในหน้าอุปกรณ์", match: (r) => r.startsWith("maintenance/assets/"), orphanCheck: true },
  { id: "avatars", system: "บัญชีผู้ใช้", label: "รูปโปรไฟล์", howToClear: "เปลี่ยนรูปในหน้าบัญชีของฉัน", match: (r) => r.startsWith("avatars/"), orphanCheck: true },
  { id: "other", system: "อื่น ๆ", label: "ไฟล์ที่ไม่เข้าหมวดไหน", howToClear: "ตรวจเป็นรายไฟล์", match: () => true, orphanCheck: false },
];

const LARGEST_PER_CATEGORY = 10;

/** "/api/files/<key>" หรือ key ล้วน → key (ตัด query ทิ้ง) */
function toKey(urlOrKey: string): string {
  return urlOrKey.replace(/^\/api\/files\//, "").split("?")[0]!;
}

const FILE_URL_RE = /\/api\/files\/[^"'\s)\\]+/g;

/** ดัชนี key → อยู่ที่ไหน ของทุกระบบที่หาได้จากฐานข้อมูล (ยกเว้นข้อความแชท — หาเฉพาะไฟล์ที่แสดง) */
async function buildReferenceIndex(orgId: string): Promise<Map<string, FileSource>> {
  const idx = new Map<string, FileSource>();
  const add = (url: string | null | undefined, src: FileSource) => {
    if (!url) return;
    const k = toKey(url);
    if (k && !idx.has(k)) idx.set(k, src);
  };

  const [workOrders, woComments, extPhotos, expenses, pos, poComments, returns, assets, companyVersions, users, chatAvatars, chatStickers, tasks, feed] =
    await Promise.all([
      prisma.workOrder.findMany({ where: { orgId }, select: { id: true, code: true, title: true, photoUrls: true, afterPhotoUrls: true } }),
      prisma.workOrderComment.findMany({ where: { orgId }, select: { workOrderId: true, imageUrl: true, imageUrls: true } }),
      prisma.workOrderExternalPhoto.findMany({ where: { orgId }, select: { workOrderId: true, storagePath: true } }),
      prisma.expense.findMany({ where: { orgId, receiptUrl: { not: null } }, select: { id: true, workOrderId: true, receiptUrl: true, description: true } }),
      prisma.purchaseOrder.findMany({ where: { orgId }, select: { id: true, code: true, title: true, receiptImageUrl: true, receiptImageUrls: true, prImageUrls: true } }),
      prisma.purchaseOrderComment.findMany({ where: { orgId }, select: { purchaseOrderId: true, imageUrls: true } }),
      prisma.equipmentReturn.findMany({ where: { orgId }, select: { purchaseOrderId: true, itemName: true, imageUrls: true } }),
      prisma.asset.findMany({ where: { orgId, imageUrl: { not: null } }, select: { id: true, name: true, imageUrl: true } }),
      prisma.companyFileVersion.findMany({ where: { file: { orgId } }, select: { storageKey: true, versionNumber: true, file: { select: { id: true, name: true, deletedAt: true } } } }),
      prisma.user.findMany({ where: { orgId, avatarUrl: { not: null } }, select: { id: true, name: true, avatarUrl: true } }),
      prisma.chatChannel.findMany({ where: { orgId, avatarUrl: { not: null } }, select: { id: true, name: true, avatarUrl: true } }),
      prisma.chatSticker.findMany({ where: { orgId }, select: { url: true, name: true, pack: { select: { name: true } } } }),
      prisma.reportTask.findMany({ where: { orgId }, select: { id: true, code: true, title: true, data: true } }),
      readStore<{ topics?: { id: string; name: string }[]; posts?: { id: string; topicId: string; title?: string }[] }>(orgId, "report-feed"),
    ]);

  const woName = new Map(workOrders.map((w) => [w.id, `${w.code ?? ""} ${w.title}`.trim()]));
  const woSrc = (id: string, what: string): FileSource => ({ label: `${what} ${woName.get(id) ?? ""}`.trim(), href: `/maintenance/work-orders/${id}` });
  for (const w of workOrders) for (const u of [...w.photoUrls, ...w.afterPhotoUrls]) add(u, woSrc(w.id, "ใบงาน"));
  for (const c of woComments) for (const u of [c.imageUrl, ...c.imageUrls]) add(u, woSrc(c.workOrderId, "ความคิดเห็นในใบงาน"));
  for (const p of extPhotos) add(p.storagePath, woSrc(p.workOrderId, "รูปช่างภายนอก ใบงาน"));
  for (const e of expenses)
    add(e.receiptUrl, e.workOrderId ? woSrc(e.workOrderId, "ใบเสร็จค่าใช้จ่าย ใบงาน") : { label: `ใบเสร็จค่าใช้จ่าย ${e.description ?? ""}`.trim(), href: "/maintenance/expenses" });

  const poName = new Map(pos.map((p) => [p.id, `${p.code} ${p.title}`]));
  const poSrc = (id: string, what: string): FileSource => ({ label: `${what} ${poName.get(id) ?? ""}`.trim(), href: `/maintenance/purchase-orders/${id}` });
  for (const p of pos) for (const u of [p.receiptImageUrl, ...p.receiptImageUrls, ...p.prImageUrls]) add(u, poSrc(p.id, "PR/PO"));
  for (const c of poComments) for (const u of c.imageUrls) add(u, poSrc(c.purchaseOrderId, "ความคิดเห็นใน PR/PO"));
  for (const r of returns) for (const u of r.imageUrls) add(u, poSrc(r.purchaseOrderId, `คืนของ${r.itemName ? ` (${r.itemName})` : ""} ·`));
  for (const a of assets) add(a.imageUrl, { label: `อุปกรณ์ ${a.name}`, href: `/maintenance/assets/${a.id}` });

  for (const v of companyVersions)
    add(v.storageKey, {
      label: `ไฟล์บริษัท ${v.file.name}${v.versionNumber > 1 ? ` (เวอร์ชัน ${v.versionNumber})` : ""}${v.file.deletedAt ? " · อยู่ในถังขยะ" : ""}`,
      href: v.file.deletedAt ? "/company-files/trash" : `/company-files/file/${v.file.id}`,
    });

  for (const u of users) add(u.avatarUrl, { label: `รูปโปรไฟล์ ${u.name}`, href: null });
  for (const c of chatAvatars) add(c.avatarUrl, { label: `รูปกลุ่มแชท ${c.name ?? ""}`.trim(), href: `/chat-report/chat?c=${encodeURIComponent(c.id)}` });
  for (const s of chatStickers) add(s.url, { label: `สติกเกอร์ ${s.name} · ชุด ${s.pack?.name ?? "ทั่วไป"}`, href: null });

  // งานบนบอร์ด / โปรเจกต์ — ไฟล์แนบอยู่ในก้อน data (JSON) ทั้งก้อน
  for (const t of tasks) {
    const urls = JSON.stringify(t.data ?? null).match(FILE_URL_RE) ?? [];
    for (const u of urls) add(u, { label: `งาน ${t.code} ${t.title}`, href: `/report-task/tasks?task=${encodeURIComponent(t.id)}` });
  }
  // โพสต์รีพอร์ต (รวมรูปในคำตอบกลับ) — ทั้งก้อนโพสต์เป็น JSON
  const topicName = new Map((feed.data?.topics ?? []).map((t) => [t.id, t.name]));
  for (const p of feed.data?.posts ?? []) {
    const urls = JSON.stringify(p).match(FILE_URL_RE) ?? [];
    const src: FileSource = {
      label: `โพสต์ #${topicName.get(p.topicId) ?? "?"} · ${p.title || "(ไม่มีหัวข้อ)"}`,
      href: `/chat-report/report-feed?topic=${encodeURIComponent(p.topicId)}&post=${encodeURIComponent(p.id)}`,
    };
    for (const u of urls) add(u, src);
  }
  return idx;
}

/** ไฟล์แชทที่แสดงในรายการใหญ่สุด — หาข้อความต้นทางทีละไฟล์ (ไม่ดึงข้อความแชททั้งบริษัท) */
async function chatSource(orgId: string, key: string): Promise<FileSource | null> {
  const url = `/api/files/${key}`;
  const rows = await prisma.$queryRaw<{ channel_id: string; name: string | null }[]>`
    SELECT m.channel_id, c.name
    FROM chat.messages m JOIN chat.channels c ON c.id = m.channel_id
    WHERE m.org_id = ${orgId} AND m.attachments::text LIKE ${`%${url}%`}
    LIMIT 1
  `.catch(() => []);
  const r = rows[0];
  if (!r) return null;
  return { label: `แชท ${r.name ?? "ห้องส่วนตัว"}`, href: `/chat-report/chat?c=${encodeURIComponent(r.channel_id)}` };
}

export interface StorageBreakdown {
  totalBytes: number;
  totalCount: number;
  categories: StorageCategory[];
}

export async function getStorageBreakdown(orgId: string): Promise<StorageBreakdown> {
  const [own, legacyPo, legacyExternal, idx] = await Promise.all([
    listStoredFiles(`${orgId}/`),
    listStoredFiles("maintenance/purchase-orders/"),
    listStoredFiles("maintenance/external/"),
    buildReferenceIndex(orgId),
  ]);

  // key เก่าที่ไม่มี orgId นำหน้า — นับเฉพาะที่บริษัทนี้อ้างถึง
  const objects: { obj: StoredObject; rest: string }[] = [
    ...own.map((obj) => ({ obj, rest: obj.key.slice(orgId.length + 1) })),
    ...[...legacyPo, ...legacyExternal].filter((o) => idx.has(o.key)).map((obj) => ({ obj, rest: obj.key })),
  ];

  const buckets = new Map<string, { def: CategoryDef; files: CategoryFile[] }>();
  for (const def of CATEGORIES) buckets.set(def.id, { def, files: [] });
  for (const { obj, rest } of objects) {
    const def = CATEGORIES.find((c) => c.match(rest))!;
    buckets.get(def.id)!.files.push({ key: obj.key, size: obj.size, lastModified: obj.lastModified, source: idx.get(obj.key) ?? null });
  }

  const categories: StorageCategory[] = [];
  for (const { def, files } of buckets.values()) {
    if (files.length === 0) continue;
    const largest = [...files].sort((a, b) => b.size - a.size).slice(0, LARGEST_PER_CATEGORY);
    if (def.system === "แชท") {
      for (const f of largest) if (!f.source) f.source = await chatSource(orgId, f.key);
    }
    const orphans = def.orphanCheck ? files.filter((f) => !f.source) : null;
    categories.push({
      id: def.id,
      system: def.system,
      label: def.label,
      howToClear: def.howToClear,
      bytes: files.reduce((s, f) => s + f.size, 0),
      count: files.length,
      orphanBytes: orphans ? orphans.reduce((s, f) => s + f.size, 0) : null,
      orphanCount: orphans ? orphans.length : null,
      largest,
    });
  }
  categories.sort((a, b) => b.bytes - a.bytes);
  return {
    totalBytes: categories.reduce((s, c) => s + c.bytes, 0),
    totalCount: categories.reduce((s, c) => s + c.count, 0),
    categories,
  };
}
