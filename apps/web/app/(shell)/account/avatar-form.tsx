"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@smartboss/ui/components/button";

import { compressImage } from "@/modules/chat/lib/image-compress";
import { updateOwnAvatarAction } from "./actions";

/**
 * อัปโหลดรูปโปรไฟล์ — ย่อรูปในเครื่องก่อนส่ง รูปจากกล้องมือถือ (5–12MB) เดิมเกินเพดาน 5MB แล้ว
 * server action โยน error ขึ้นหน้า "This page couldn't load" ทั้งหน้า ส่วนในคอมรูปเล็กจึงผ่าน
 * ใช้รูปย่อ ~480px (พอสำหรับรูปโปรไฟล์ที่แสดงใหญ่สุด 80px) ถ้าย่อไม่ได้ส่งรูปเต็มที่ย่อแล้วแทน
 */
export function AvatarForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return toast.error("กรุณาเลือกไฟล์รูปภาพ");
    setBusy(true);
    try {
      const { full, thumb } = await compressImage(file);
      const data = new FormData();
      data.set("avatar", file.type === "image/gif" ? full : (thumb ?? full));
      const result = await updateOwnAvatarAction(data);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("เปลี่ยนรูปโปรไฟล์แล้ว");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch {
      toast.error("อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        ref={inputRef}
        type="file"
        name="avatar"
        accept="image/jpeg,image/png,image/webp,image/gif"
        required
        className="block w-full text-sm text-(--ink-soft) file:mr-3 file:rounded-(--radius) file:border-0 file:bg-(--bg-soft) file:px-3 file:py-2 file:text-sm file:font-medium file:text-(--ink) hover:file:bg-(--line)"
      />
      <Button type="submit" variant="outline" className="h-11 shrink-0" disabled={busy}>
        {busy ? "กำลังอัปโหลด…" : "อัปโหลด"}
      </Button>
    </form>
  );
}
