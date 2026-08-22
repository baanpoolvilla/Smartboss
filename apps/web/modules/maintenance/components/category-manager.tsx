"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FolderPlus,
  Pencil,
  Settings2,
  Trash2,
} from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import { Button } from "@smartboss/ui/components/button";
import { Input } from "@smartboss/ui/components/input";
import { Modal } from "./dialog";

export interface CategoryItem {
  id: string;
  displayName: string;
  propertyCount: number;
}

/**
 * จัดการหมวดหมู่บ้าน — สร้าง / เปลี่ยนชื่อ / เรียงลำดับ / ลบ
 *
 * ทุกปุ่มเป็น <form action={serverAction}> ไม่ใช่ fetch เอง — ฟอร์มธรรมดาทำงาน
 * ได้แม้ JS ยังโหลดไม่เสร็จ และไม่ต้องจัดการสถานะ loading/error เอง
 */
export function CategoryManager({
  categories,
  createAction,
  renameAction,
  deleteAction,
  moveAction,
}: {
  categories: CategoryItem[];
  createAction: (formData: FormData) => void | Promise<void>;
  renameAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  moveAction: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<CategoryItem | null>(null);
  const [deleting, setDeleting] = useState<CategoryItem | null>(null);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Settings2 className="h-4 w-4" /> จัดการหมวดหมู่
      </Button>

      {open && (
        <Modal
          title="หมวดหมู่บ้าน"
          wide
          onClose={() => setOpen(false)}
          actions={
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              ปิด
            </Button>
          }
        >
          {/* ─── เพิ่มหมวดใหม่ ─── */}
          <form action={createAction} className="mb-4 flex gap-2">
            <Input
              name="displayName"
              required
              maxLength={100}
              placeholder="ชื่อหมวดใหม่ เช่น พูลวิลล่าพัทยา"
              className="flex-1"
            />
            <Button type="submit" size="sm">
              <FolderPlus className="h-4 w-4" /> เพิ่ม
            </Button>
          </form>

          {categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-(--ink-soft)">
              ยังไม่มีหมวดหมู่ — สร้างหมวดแรกจากช่องด้านบน
            </p>
          ) : (
            <ul className="flex flex-col">
              {categories.map((c, i) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 border-b border-(--line) py-2 last:border-0"
                >
                  <div className="flex shrink-0 flex-col">
                    <MoveButton
                      action={moveAction}
                      id={c.id}
                      dir="up"
                      disabled={i === 0}
                    />
                    <MoveButton
                      action={moveAction}
                      id={c.id}
                      dir="down"
                      disabled={i === categories.length - 1}
                    />
                  </div>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-(--ink)">
                      {c.displayName}
                    </span>
                    <span className="block text-xs text-(--ink-soft)">
                      {c.propertyCount} หลัง
                    </span>
                  </span>

                  <button
                    type="button"
                    title="เปลี่ยนชื่อ"
                    onClick={() => setRenaming(c)}
                    className="shrink-0 rounded-(--radius) p-2 text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="ลบหมวด"
                    onClick={() => setDeleting(c)}
                    className="shrink-0 rounded-(--radius) p-2 text-[#DC2626] hover:bg-[#FEF2F2]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      {/* ─── เปลี่ยนชื่อหมวด ─── */}
      {renaming && (
        <Modal
          title="เปลี่ยนชื่อหมวด"
          onClose={() => setRenaming(null)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                ยกเลิก
              </Button>
              <Button type="submit" form="cat-rename" size="sm">
                บันทึก
              </Button>
            </>
          }
        >
          <form id="cat-rename" action={renameAction}>
            <input type="hidden" name="id" value={renaming.id} />
            <Input
              name="displayName"
              defaultValue={renaming.displayName}
              required
              maxLength={100}
            />
          </form>
        </Modal>
      )}

      {/* ─── ยืนยันลบ ─── */}
      {deleting && (
        <Modal
          title={`ลบหมวด "${deleting.displayName}"`}
          onClose={() => setDeleting(null)}
          actions={
            <>
              <Button type="button" variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                ยกเลิก
              </Button>
              <Button
                type="submit"
                form="cat-delete"
                size="sm"
                className="bg-[#DC2626] hover:bg-[#B91C1C]"
              >
                ลบหมวด
              </Button>
            </>
          }
        >
          <form id="cat-delete" action={deleteAction}>
            <input type="hidden" name="id" value={deleting.id} />
            <p className="text-sm text-(--ink)">
              {deleting.propertyCount > 0 ? (
                <>
                  <b>บ้าน {deleting.propertyCount} หลังไม่ถูกลบ</b> —
                  จะย้ายไปกอง &ldquo;ยังไม่จัดหมวด&rdquo; ให้จัดใหม่ทีหลัง
                </>
              ) : (
                "หมวดนี้ยังไม่มีบ้านอยู่"
              )}
            </p>
          </form>
        </Modal>
      )}
    </>
  );
}

function MoveButton({
  action,
  id,
  dir,
  disabled,
}: {
  action: (formData: FormData) => void | Promise<void>;
  id: string;
  dir: "up" | "down";
  disabled: boolean;
}) {
  const Icon = dir === "up" ? ChevronUp : ChevronDown;
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="dir" value={dir} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={dir === "up" ? "เลื่อนขึ้น" : "เลื่อนลง"}
        className="flex h-5 w-6 items-center justify-center text-(--ink-soft) hover:text-(--ink) disabled:opacity-25"
      >
        <Icon className="h-4 w-4" />
      </button>
    </form>
  );
}
