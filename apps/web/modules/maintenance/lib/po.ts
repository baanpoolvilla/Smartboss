export const PO_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "รอ CEO อนุมัติ", color: "#EA580C" },
  approved: { label: "PO ที่ได้รับ", color: "#2563EB" },
  ordered: { label: "กำลังดำเนินการ", color: "#4F46E5" },
  received: { label: "รับของแล้ว", color: "#16A34A" },
  cancelled: { label: "ยกเลิก", color: "#6B7280" },
};

export function poStatusMeta(s: string) {
  return PO_STATUS[s] ?? { label: s, color: "#6B7280" };
}

export interface PoItem {
  name: string;
  qty: number;
  unitPrice: number;
}

export function poItemsFromJson(v: unknown): PoItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      name: String(o.name ?? ""),
      qty: Number(o.qty ?? 1),
      unitPrice: Number(o.unit_price ?? o.unitPrice ?? 0),
    };
  });
}

export function poItemsToJson(items: PoItem[]) {
  return items.map((i) => ({ name: i.name, qty: i.qty, unit_price: i.unitPrice }));
}

export function poItemsTotal(items: PoItem[]): number {
  return items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
}
