"use server";

import { z } from "zod";
import { prisma } from "@smartboss/database";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOrg, hasPermission, isSuperAdmin } from "@smartboss/auth";
import { MAINT_PERMS } from "@/modules/maintenance/permissions";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  addPoComment,
  deletePoComment,
} from "@/modules/maintenance/data/purchase-orders";
import {
  createEquipmentReturn,
  getEquipmentReturn,
  updateEquipmentReturnStatus,
  deleteEquipmentReturn,
} from "@/modules/maintenance/data/equipment-returns";
import { createExpense } from "@/modules/maintenance/data/expenses";
import { getWorkOrder } from "@/modules/maintenance/data/work-orders";
import { notifyUser } from "@/modules/maintenance/data/notify";
import { putFile, putFiles, deleteFiles } from "@/modules/maintenance/lib/storage";
import {
  poItemsFromJson,
  poItemsToJson,
  poItemsTotal,
  type PoItem,
} from "@/modules/maintenance/lib/po";

function readItems(formData: FormData, withPricing: boolean): PoItem[] {
  const names = formData.getAll("itemName").map(String);
  const qtys = formData.getAll("itemQty").map(String);
  const prices = formData.getAll("itemPrice").map(String);
  const items: PoItem[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = (names[i] ?? "").trim();
    if (!name) continue;
    // PR ปกติยังไม่รู้ราคา → เก็บ qty/price = 0 (ผู้รับ PO กรอกตอนไปซื้อ)
    items.push({
      name,
      qty: withPricing ? Math.max(1, Number(qtys[i] ?? "1") || 1) : 0,
      unitPrice: withPricing ? Math.max(0, Number(prices[i] ?? "0") || 0) : 0,
    });
  }
  return items;
}

const createSchema = z.object({
  title: z.string().trim().min(1, "กรอกหัวข้อ").max(200),
  description: z.string().trim().max(1000).optional(),
  propertyId: z.string().optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** เปิด PR (รอ CEO อนุมัติ) หรือ "เปิด PO เลย" สำหรับ role สูง */
export async function createPoAction(formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.poCreate)) {
    throw new Error("ไม่มีสิทธิ์สร้างใบขอซื้อ");
  }
  const parsed = createSchema.safeParse({
    title: formData.get("title"),
    description: (formData.get("description") as string) || undefined,
    propertyId: (formData.get("propertyId") as string) || undefined,
    notes: (formData.get("notes") as string) || undefined,
  });
  if (!parsed.success) return;
  const d = parsed.data;

  /**
   * ใบงานต้นทาง — ต้องอ่านจากฐานข้อมูลก่อน ห้ามเชื่อค่าที่ส่งมาจากฟอร์ม
   *
   * getWorkOrder กรองด้วย orgId อยู่แล้ว ⇒ ยิง id ของบริษัทอื่นเข้ามาจะได้ null
   * แล้วกลายเป็น PR/PO ที่ไม่ผูกกับใบงาน ไม่ใช่ PR/PO ที่ผูกข้ามบริษัท
   *
   * ⚠ ต้องเช็ค row-level ซ้ำที่นี่ด้วย ไม่ใช่เช็คแค่ตอน render หน้าเปิดฟอร์ม —
   * ฟอร์มถูกยิงตรงได้ ช่างที่เห็นเฉพาะงานตัวเองจึงไม่ควรผูก PR เข้าใบงานคนอื่น
   * (เกณฑ์เดียวกับหน้ารายละเอียดใบงาน)
   */
  const woId = String(formData.get("workOrderId") ?? "");
  const wo = woId ? await getWorkOrder(s.orgId, woId) : null;
  const linkedWo =
    wo &&
    (hasPermission(s, MAINT_PERMS.workorderManage) ||
      wo.assignedTo === s.userId ||
      wo.createdBy === s.userId)
      ? wo
      : null;

  const isEmergency = formData.get("isEmergency") === "1";
  const wantsPo = formData.get("openAsPo") === "1";
  const canOpenPo = hasPermission(s, MAINT_PERMS.poApprove);
  const openPo = wantsPo && canOpenPo && !isEmergency;

  const items = readItems(formData, isEmergency);
  const emergencyReason =
    String(formData.get("emergencyReason") ?? "").trim() || null;
  const prImageUrls = await putFiles(
    `${s.orgId}/maintenance/purchase-orders`,
    formData.getAll("prImages").filter((f): f is File => f instanceof File)
  );
  const now = new Date();

  await createPurchaseOrder(s.orgId, {
    title: d.title,
    description: d.description ?? null,
    // เปิดจากใบงาน = ใช้บ้านของใบงานนั้นเสมอ ไม่ให้เลือกใหม่ให้ขัดกัน
    propertyId: linkedWo ? linkedWo.propertyId : d.propertyId || null,
    workOrderId: linkedWo?.id ?? null,
    items,
    totalPrice: isEmergency ? poItemsTotal(items) : 0,
    notes: d.notes ?? null,
    isEmergencyPurchase: isEmergency,
    emergencyReason: isEmergency ? emergencyReason : null,
    createdBy: s.userId,
    prImageUrls,
    status: openPo ? "approved" : "pending",
    poAssignedTo: openPo ? (String(formData.get("poAssignedTo") ?? "") || null) : null,
    poCreatedBy: openPo ? s.userId : null,
    poCreatedAt: openPo ? now : null,
  });

  revalidatePath("/maintenance/purchase-orders");
  if (linkedWo) {
    // กลับไปที่ใบงานที่กดมา ไม่ใช่บอร์ด PR/PO — คนกดยังทำงานใบนั้นค้างอยู่
    revalidatePath(`/maintenance/work-orders/${linkedWo.id}`);
    redirect(`/maintenance/work-orders/${linkedWo.id}`);
  }
  redirect("/maintenance/purchase-orders");
}

/**
 * คืน userId ก็ต่อเมื่อเป็นคนในบริษัทนี้จริง ไม่งั้นคืน null
 *
 * ค่ามาจาก <select> ในฟอร์ม ซึ่งแก้ค่าใน DevTools ได้ — ถ้าไม่ตรวจ จะผูก
 * "ผู้รับของ" เป็น id ของคนในบริษัทอื่นได้ แล้วชื่อคนนอกจะไปโผล่บนใบสั่งซื้อเรา
 */
async function orgUserId(
  orgId: string,
  userId: string | null | undefined
): Promise<string | null> {
  if (!userId) return null;
  const found = await prisma.user.findFirst({
    where: { orgId, id: userId, isActive: true },
    select: { id: true },
  });
  return found ? found.id : null;
}

async function ceoOnly() {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.poApprove)) {
    throw new Error("เฉพาะ CEO เท่านั้นที่อนุมัติได้");
  }
  return s;
}

/**
 * ลงค่าใช้จ่ายของใบสั่งซื้อ
 *
 * ถ้า PO ใบนี้เปิดมาจากใบงาน ค่าใช้จ่ายต้องผูกกับใบงานนั้นด้วย — ไม่งั้นเงินที่จ่าย
 * ไปกับงานหนึ่งจะไม่โผล่ในต้นทุนของงานนั้น และใบงานจะค้างอยู่คอลัมน์
 * "ยังไม่บันทึกค่าใช้จ่าย" ทั้งที่จ่ายไปแล้วผ่าน PO
 */
async function poExpense(
  orgId: string,
  po: {
    id: string;
    propertyId: string | null;
    title: string;
    workOrderId: string | null;
  },
  amount: number,
  userId: string | null,
  suffix = ""
) {
  if (amount <= 0) return;
  await createExpense(orgId, {
    propertyId: po.propertyId,
    purchaseOrderId: po.id,
    workOrderId: po.workOrderId,
    amount,
    description: `สั่งซื้ออุปกรณ์${suffix ? " " + suffix : ""}: ${po.title}`,
    category: "material",
    costType: "work_order",
    paidBy: "company",
    createdBy: userId,
  });
  if (po.workOrderId) {
    revalidatePath(`/maintenance/work-orders/${po.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
  }
}

/** CEO อนุมัติ PR ปกติ → approved + มอบ PO ให้คนไปซื้อ */
export async function approveNormalAction(formData: FormData) {
  const s = await ceoOnly();
  const id = String(formData.get("id") ?? "");
  const assignee = String(formData.get("assignee") ?? "") || null;
  if (!id) return;
  const po = await getPurchaseOrder(s.orgId, id);
  await updatePurchaseOrder(s.orgId, id, {
    status: "approved",
    poAssignedTo: assignee,
    poCreatedBy: s.userId,
    poCreatedAt: new Date(),
  });
  if (assignee && po) {
    await notifyUser(s.orgId, assignee, {
      title: `📦 ได้รับมอบ PO: ${po.title}`,
      body: "กรุณาดำเนินการสั่งซื้อและกรอกราคาตอนรับของ",
      type: "purchase_order",
      referenceId: id,
      line: `📦 คุณได้รับมอบ PO: ${po.title}\nเข้าดำเนินการในระบบ Smartboss`,
    });
  }
  revalidatePath(`/maintenance/purchase-orders/${id}`);
  redirect("/maintenance/purchase-orders");
}

/** CEO อนุมัติ PR ฉุกเฉิน (ซื้อไปแล้ว) → received ทันที + ลงค่าใช้จ่าย */
export async function approveEmergencyAction(formData: FormData) {
  const s = await ceoOnly();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const po = await getPurchaseOrder(s.orgId, id);
  if (!po) return;
  await updatePurchaseOrder(s.orgId, id, {
    status: "received",
    receivedBy: s.userId,
    receivedAt: new Date(),
  });
  await poExpense(s.orgId, po, Number(po.totalPrice), s.userId, "(ฉุกเฉิน)");
  revalidatePath(`/maintenance/purchase-orders/${id}`);
  redirect("/maintenance/purchase-orders");
}

export async function rejectAction(formData: FormData) {
  const s = await ceoOnly();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await updatePurchaseOrder(s.orgId, id, { status: "cancelled" });
  revalidatePath(`/maintenance/purchase-orders/${id}`);
  redirect("/maintenance/purchase-orders");
}

/**
 * ใครแตะใบนี้ได้บ้าง — CEO · คนเปิด PR · คนที่ถูกมอบให้ไปซื้อ · **คนที่ถูกมอบให้ไปรับของ**
 *
 * ⚠ ขาด receiverAssignedTo ไม่ได้ ไม่งั้นคนที่เราเพิ่งมอบหมายให้ไปรับของ
 * จะกดปุ่ม "รับของ" ไม่ได้ — ฟีเจอร์มอบหมายผู้รับจะกลายเป็นแค่ป้ายที่ไม่มีผล
 */
async function assertCanProcess(
  po: {
    poAssignedTo: string | null;
    createdBy: string | null;
    receiverAssignedTo: string | null;
  },
  s: { userId: string }
) {
  const session = await requireOrg();
  const assigned =
    po.poAssignedTo === s.userId ||
    po.createdBy === s.userId ||
    po.receiverAssignedTo === s.userId;
  if (!hasPermission(session, MAINT_PERMS.poApprove) && !assigned) {
    throw new Error("ไม่มีสิทธิ์ดำเนินการกับรายการนี้");
  }
}

/** ยืนยันดำเนินการซื้อ: กรอกจำนวน+ราคา + แนบรูป → ordered + ลงค่าใช้จ่าย */
export async function confirmOrderAction(formData: FormData) {
  const s = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const po = await getPurchaseOrder(s.orgId, id);
  if (!po) return;
  await assertCanProcess(po, s);

  const qtys = formData.getAll("itemQty").map((x) => Number(String(x)) || 0);
  const prices = formData.getAll("itemPrice").map((x) => Number(String(x)) || 0);
  const oldItems = poItemsFromJson(po.items);
  const items: PoItem[] = oldItems.map((it, i) => ({
    name: it.name,
    qty: qtys[i] ?? it.qty,
    unitPrice: prices[i] ?? it.unitPrice,
  }));
  const total = poItemsTotal(items);

  const urls = await putFiles(
    "maintenance/purchase-orders",
    formData.getAll("receiptImages").filter((f): f is File => f instanceof File)
  );

  /*
   * ผู้รับของ — คนซื้อกับคนรับของมักคนละคน (สั่งของออนไลน์แล้วให้คนเฝ้าออฟฟิศเซ็นรับ)
   * ไม่ระบุ = ปล่อยว่าง ใครที่มีสิทธิ์อยู่แล้วก็กดรับได้เหมือนเดิม
   */
  const receiver = await orgUserId(
    s.orgId,
    String(formData.get("receiverAssignedTo") ?? "") || null
  );

  await updatePurchaseOrder(s.orgId, id, {
    status: "ordered",
    items: poItemsToJson(items),
    totalPrice: total,
    ...(urls.length > 0
      ? { receiptImageUrl: urls[0], receiptImageUrls: [...po.receiptImageUrls, ...urls] }
      : {}),
    receiverAssignedTo: receiver,
    orderedBy: s.userId,
    orderedAt: new Date(),
  });
  await poExpense(s.orgId, po, total, s.userId);

  // แจ้งคนรับของ เว้นแต่เขาคือคนกดสั่งซื้อเอง (จะได้ไม่เตือนตัวเอง)
  if (receiver && receiver !== s.userId) {
    await notifyUser(s.orgId, receiver, {
      title: `📦 คุณเป็นผู้รับของ: ${po.title}`,
      body: "เมื่อของมาถึงแล้ว กดยืนยันรับของในระบบ",
      type: "purchase_order",
      referenceId: id,
      line: `📦 คุณถูกมอบหมายให้รับของ: ${po.title}
กดยืนยันรับของในระบบ Smartboss เมื่อของมาถึง`,
    });
  }

  revalidatePath(`/maintenance/purchase-orders/${id}`);
  redirect("/maintenance/purchase-orders");
}

/** รับของ: แนบรูปใบเสร็จ → received */
export async function receiveAction(formData: FormData) {
  const s = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const po = await getPurchaseOrder(s.orgId, id);
  if (!po) return;
  await assertCanProcess(po, s);

  const urls = await putFiles(
    "maintenance/purchase-orders",
    formData.getAll("receiptImages").filter((f): f is File => f instanceof File)
  );
  const all = [...po.receiptImageUrls, ...urls];

  await updatePurchaseOrder(s.orgId, id, {
    status: "received",
    ...(all.length > 0 ? { receiptImageUrl: all[0], receiptImageUrls: all } : {}),
    receivedBy: s.userId,
    receivedAt: new Date(),
  });
  revalidatePath(`/maintenance/purchase-orders/${id}`);
  redirect("/maintenance/purchase-orders");
}

/** ซื้อเอง: กรอกราคา + รูป → received + ลงค่าใช้จ่าย (ของเดิมยังรองรับอยู่) */
export async function selfReceiveAction(formData: FormData) {
  const s = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const po = await getPurchaseOrder(s.orgId, id);
  if (!po) return;
  await assertCanProcess(po, s);

  const qtys = formData.getAll("itemQty").map((x) => Number(String(x)) || 0);
  const prices = formData.getAll("itemPrice").map((x) => Number(String(x)) || 0);
  const items: PoItem[] = poItemsFromJson(po.items).map((it, i) => ({
    name: it.name,
    qty: qtys[i] ?? it.qty,
    unitPrice: prices[i] ?? it.unitPrice,
  }));
  const total = poItemsTotal(items);
  const urls = await putFiles(
    "maintenance/purchase-orders",
    formData.getAll("receiptImages").filter((f): f is File => f instanceof File)
  );
  const all = [...po.receiptImageUrls, ...urls];

  await updatePurchaseOrder(s.orgId, id, {
    status: "received",
    items: poItemsToJson(items),
    totalPrice: total,
    ...(all.length > 0 ? { receiptImageUrl: all[0], receiptImageUrls: all } : {}),
    receivedBy: s.userId,
    receivedAt: new Date(),
  });
  await poExpense(s.orgId, po, total, s.userId, "(ซื้อเอง)");
  revalidatePath(`/maintenance/purchase-orders/${id}`);
  redirect("/maintenance/purchase-orders");
}

export async function addPoCommentAction(poId: string, formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.poView)) return;
  const content = String(formData.get("content") ?? "").trim();
  const file = formData.get("image");
  const imageUrl =
    file instanceof File && file.size > 0
      ? await putFile(`${s.orgId}/maintenance/purchase-orders`, file)
      : null;
  if (!content && !imageUrl) return;
  await addPoComment(
    s.orgId,
    poId,
    s.userId,
    content || "📷",
    imageUrl ? [imageUrl] : []
  );
  revalidatePath(`/maintenance/purchase-orders/${poId}`);
}

/**
 * ลบคอมเมนต์ PO พร้อมเก็บกวาดรูปใน storage
 *
 * ลบแถวก่อนแล้วค่อยลบไฟล์ — ถ้าลบไฟล์ก่อนแล้วลบแถวล้ม จะเหลือคอมเมนต์ที่มี
 * รูปเสียค้างอยู่ ซึ่งแย่กว่าไฟล์กำพร้าที่แค่เปลืองพื้นที่
 */
export async function deletePoCommentAction(poId: string, formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.poView)) return;
  const commentId = String(formData.get("commentId") ?? "");
  if (!commentId) return;

  const images = await deletePoComment(
    s.orgId,
    commentId,
    s.userId,
    hasPermission(s, MAINT_PERMS.poApprove)
  );
  if (images.length > 0) await deleteFiles(images);

  revalidatePath(`/maintenance/purchase-orders/${poId}`);
}

export async function deletePoAction(formData: FormData) {
  const s = await requireOrg();
  if (!isSuperAdmin(s)) throw new Error("เฉพาะผู้ดูแลระบบสูงสุดเท่านั้น");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deletePurchaseOrder(s.orgId, id);
  revalidatePath("/maintenance/purchase-orders");
  redirect("/maintenance/purchase-orders");
}

// ═══════════════ คืนของ / ของมีปัญหา ═══════════════

export async function createReturnAction(formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.poView)) {
    throw new Error("ไม่มีสิทธิ์แจ้งคืนของ");
  }
  const purchaseOrderId = String(formData.get("purchaseOrderId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!purchaseOrderId || !reason) return;

  const po = await getPurchaseOrder(s.orgId, purchaseOrderId);
  if (!po) return;

  const imageUrls = await putFiles(
    `${s.orgId}/maintenance/returns`,
    formData.getAll("images").filter((f): f is File => f instanceof File)
  );

  await createEquipmentReturn(s.orgId, {
    purchaseOrderId,
    propertyId: po.propertyId,
    itemName: String(formData.get("itemName") ?? "") || null,
    qty: Math.max(1, Number(formData.get("qty") ?? "1") || 1),
    problemType: String(formData.get("problemType") ?? "other"),
    reason,
    imageUrls,
    createdBy: s.userId,
  });

  revalidatePath("/maintenance/purchase-orders");
  redirect("/maintenance/purchase-orders?tab=returns");
}

/** ผู้จัดการขึ้นไป หรือผู้แจ้งเอง จัดการสถานะได้ */
async function assertCanManageReturn(orgId: string, id: string) {
  const s = await requireOrg();
  const r = await getEquipmentReturn(orgId, id);
  if (!r) throw new Error("ไม่พบรายการ");
  const isManagerUp = hasPermission(s, MAINT_PERMS.contractorManage);
  if (!isManagerUp && r.createdBy !== s.userId) {
    throw new Error("ไม่มีสิทธิ์จัดการรายการนี้");
  }
  return s;
}

export async function setReturnStatusAction(formData: FormData) {
  const session = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !status) return;
  const s = await assertCanManageReturn(session.orgId, id);
  const note = String(formData.get("resolutionNote") ?? "").trim() || null;
  await updateEquipmentReturnStatus(s.orgId, id, status, {
    resolvedBy: s.userId,
    resolutionNote: note,
  });
  revalidatePath(`/maintenance/purchase-orders/returns/${id}`);
  revalidatePath("/maintenance/purchase-orders");
}

export async function deleteReturnAction(formData: FormData) {
  const s = await requireOrg();
  if (!hasPermission(s, MAINT_PERMS.contractorManage)) {
    throw new Error("ไม่มีสิทธิ์ลบรายการนี้");
  }
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteEquipmentReturn(s.orgId, id);
  revalidatePath("/maintenance/purchase-orders");
  redirect("/maintenance/purchase-orders?tab=returns");
}
