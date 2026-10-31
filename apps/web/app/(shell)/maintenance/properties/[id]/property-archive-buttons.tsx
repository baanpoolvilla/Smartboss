"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { deletePropertyAction, setPropertyArchivedAction } from "../actions";

/**
 * เลิกใช้บ้าน / ใช้ต่อ / ลบจริง (ผู้ใช้ 31/10/2569 "ช่างใหญ่ลบบ้านออกไม่ได้ ต้องแจ้ง IT อย่างเดียว")
 * เลิกใช้ = หายจากรายชื่อและช่องเลือกบ้าน แต่ประวัติอยู่ครบ กดใช้ต่อได้ · ลบจริง = ลบใบงาน/PM/อุปกรณ์ของบ้านไปด้วย
 * ทั้งสองแบบต้องกดยืนยันอีกครั้ง (เดิมปุ่มลบไม่ถามเลย)
 */
export function PropertyArchiveButtons({
  id,
  name,
  archived,
  canArchive,
  canDelete,
  counts,
}: {
  id: string;
  name: string;
  archived: boolean;
  canArchive: boolean;
  canDelete: boolean;
  counts: { workOrders: number; pm: number; assets: number };
}) {
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);

  if (confirm) {
    const isDelete = confirm === "delete";
    return (
      <div className="flex max-w-md flex-col gap-2 rounded-lg border border-(--line) bg-(--bg) p-3 text-sm shadow-sm">
        <p className="font-semibold text-(--ink)">{isDelete ? `ลบบ้าน "${name}" ถาวร?` : `เลิกใช้บ้าน "${name}"?`}</p>
        {isDelete ? (
          <p className="text-(--danger)">
            จะลบใบงาน {counts.workOrders} ใบ · แผน PM {counts.pm} รายการ · อุปกรณ์ {counts.assets} รายการ ของบ้านนี้ไปด้วย กู้คืนไม่ได้
            {canArchive && " — ถ้าแค่ไม่ใช้แล้ว ให้กด “เลิกใช้บ้าน” แทน"}
          </p>
        ) : (
          <p className="text-(--ink-soft)">
            บ้านจะหายจากรายชื่อและช่องเลือกบ้านตอนสร้างใบงาน/PM/สั่งของ · ใบงานและค่าใช้จ่ายเก่ายังอยู่ครบ · กดใช้ต่อได้ทุกเมื่อ
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)}>
            ยกเลิก
          </Button>
          <form action={isDelete ? deletePropertyAction : setPropertyArchivedAction}>
            <input type="hidden" name="id" value={id} />
            {!isDelete && <input type="hidden" name="archived" value="1" />}
            <Button type="submit" size="sm" variant={isDelete ? "danger" : "primary"}>
              {isDelete ? "ลบถาวร" : "เลิกใช้บ้าน"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <>
      {canArchive &&
        (archived ? (
          <form action={setPropertyArchivedAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="archived" value="0" />
            <Button type="submit" variant="outline" size="sm" className="gap-1">
              <ArchiveRestore className="h-4 w-4" /> ใช้บ้านนี้ต่อ
            </Button>
          </form>
        ) : (
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setConfirm("archive")}>
            <Archive className="h-4 w-4" /> เลิกใช้บ้าน
          </Button>
        ))}
      {canDelete && (
        <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={() => setConfirm("delete")}>
          <Trash2 className="h-4 w-4" /> ลบ
        </Button>
      )}
    </>
  );
}
