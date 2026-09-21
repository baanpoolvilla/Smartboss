"use client";

import { useState } from "react";
import { selectClass } from "@/modules/admin/components/ui";

export interface FilterModule {
  id: string;
  name: string;
}
export interface FilterMenu {
  path: string;
  label: string;
}

/**
 * ตัวกรอง "โมดูลที่แจ้ง" + "เมนู" ที่สัมพันธ์กัน — ต้องเลือกโมดูลก่อน เมนูถึงจะเลือกได้
 * และแสดงเฉพาะเมนูของโมดูลนั้น (เปลี่ยนโมดูลแล้วเมนูที่เลือกไว้รีเซ็ต) วางในฟอร์ม GET
 * ของหน้ารายการ ส่งค่าเป็น ?module=…&menu=… เหมือนเดิม (select ที่ disabled ไม่ถูกส่งไปกับฟอร์ม)
 */
export function ModuleMenuFilter({
  modules,
  menusByModule,
  defaultModule,
  defaultMenu,
}: {
  modules: FilterModule[];
  menusByModule: Record<string, FilterMenu[]>;
  defaultModule: string;
  defaultMenu: string;
}) {
  const [moduleId, setModuleId] = useState(defaultModule);
  const [menu, setMenu] = useState(defaultMenu);
  const menus = moduleId ? (menusByModule[moduleId] ?? []) : [];

  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-(--ink-soft)">โมดูลที่แจ้ง</span>
        <select
          name="module"
          value={moduleId}
          onChange={(e) => {
            setModuleId(e.target.value);
            setMenu("");
          }}
          className={selectClass}
        >
          <option value="">ทุกโมดูล</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-(--ink-soft)">เมนู</span>
        <select
          name="menu"
          value={menu}
          onChange={(e) => setMenu(e.target.value)}
          disabled={!moduleId || menus.length === 0}
          className={selectClass}
        >
          <option value="">
            {!moduleId ? "เลือกโมดูลก่อน" : menus.length === 0 ? "โมดูลนี้ไม่มีเมนูให้เลือก" : "ทุกเมนู"}
          </option>
          {menus.map((m) => (
            <option key={m.path} value={m.path}>{m.label}</option>
          ))}
        </select>
      </label>
    </>
  );
}
