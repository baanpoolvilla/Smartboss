/**
 * รหัสพนักงานอัตโนมัติ — ผู้ใช้ 16/11/2569 "อยากให้สร้างให้ออโต้ ทำไมต้องมากรอกเอง"
 *
 * ดูรหัสที่มีอยู่แล้วของบริษัท เลือกรูปแบบที่ใช้มากที่สุด (เช่น "GL-" + เลข 3 หลัก)
 * แล้วต่อเลขจากเลขสูงสุด: GL-023 → GL-024, GL-025 …  ข้ามรหัสที่ถูกใช้แล้วเสมอ
 * ยังไม่มีรหัสเลย = เริ่ม EMP-001 · ช่องกรอกเองยังใช้ได้ (กรอก = ใช้ค่าที่กรอก)
 */
export interface CodeAllocator {
  /** รหัสถัดไป (ยังไม่ถูกจอง) — ไม่จองให้ เรียกซ้ำได้ค่าเดิม */
  peek(): string;
  /** จองรหัสถัดไปแล้วคืนค่า */
  take(): string;
  /** บอกว่ารหัสนี้ถูกใช้แล้ว (เช่น คนกรอกเอง หรือ API ตอบว่าซ้ำ) */
  markUsed(code: string): void;
}

const CODE_RE = /^(.*?)(\d+)$/;

export function employeeCodeAllocator(existing: string[]): CodeAllocator {
  const used = new Set(existing.map((c) => c.trim().toLowerCase()).filter(Boolean));

  // รูปแบบ = prefix + จำนวนหลัก · นับว่ารูปแบบไหนใช้บ่อยสุด
  const groups = new Map<string, { prefix: string; width: number; count: number; max: number }>();
  for (const raw of existing) {
    const m = CODE_RE.exec(raw.trim());
    if (!m) continue;
    const prefix = m[1]!;
    const digits = m[2]!;
    const key = `${prefix}\u0000${digits.length}`;
    const g = groups.get(key) ?? { prefix, width: digits.length, count: 0, max: 0 };
    g.count += 1;
    g.max = Math.max(g.max, Number(digits));
    groups.set(key, g);
  }
  const best = [...groups.values()].sort((a, b) => b.count - a.count || b.max - a.max)[0] ?? {
    prefix: "EMP-",
    width: 3,
    count: 0,
    max: 0,
  };

  let n = best.max;
  const format = (num: number) => `${best.prefix}${String(num).padStart(best.width, "0")}`;
  const next = () => {
    let k = n + 1;
    while (used.has(format(k).toLowerCase())) k += 1;
    return k;
  };

  return {
    peek: () => format(next()),
    take: () => {
      n = next();
      const code = format(n);
      used.add(code.toLowerCase());
      return code;
    },
    markUsed: (code) => {
      used.add(code.trim().toLowerCase());
    },
  };
}
