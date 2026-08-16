"use client";

import { useState } from "react";
import { Button } from "@smartboss/ui/components/button";

/**
 * ปุ่มลบผู้ใช้ — เมื่อคนนี้เป็นหัวหน้าแผนกอยู่ ต้องมีการ "ยืนยันจริง" ก่อนถึงจะ
 * ส่ง `confirmHeadRemoval=1` ไปกับฟอร์มได้ ไม่ใช่ hidden field ที่ฝังไว้ล่วงหน้า
 * ตั้งแต่ render แรก (ของเดิม) — แบบนั้นเซิร์ฟเวอร์เช็คไปก็ไม่มีความหมาย เพราะ
 * ค่าที่ต้องเช็คมันอยู่ตรงนั้นเสมออยู่แล้วไม่ว่าจะกดยืนยันหรือไม่
 *
 * ต้อง "คลิกจริง" ก่อน component ถึงจะ render hidden field/ปุ่ม submit ตัวจริง
 * ออกมา — ถ้า JS ถูกปิด/บล็อก ฟอร์มจะไม่มีทางส่ง confirmHeadRemoval ไปได้เลย
 * (fail closed แทนที่จะ fail open แบบเดิม)
 */
export function DeleteUserButton({
  userName,
  headOfCount,
  disabled,
}: {
  userName: string;
  headOfCount: number;
  disabled?: boolean;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  if (headOfCount > 0 && !acknowledged) {
    return (
      <Button
        type="button"
        size="sm"
        variant="danger"
        disabled={disabled}
        onClick={() => {
          if (
            confirm(
              `"${userName}" เป็นหัวหน้าแผนกอยู่ ${headOfCount} แผนก — ลบแล้วแผนกนั้นจะไม่มีหัวหน้า ต้องการลบต่อไหม?`
            )
          ) {
            setAcknowledged(true);
          }
        }}
      >
        ลบผู้ใช้
      </Button>
    );
  }

  return (
    <>
      {headOfCount > 0 && <input type="hidden" name="confirmHeadRemoval" value="1" />}
      <Button
        type="submit"
        size="sm"
        variant="danger"
        disabled={disabled}
        onClick={(e) => {
          if (headOfCount === 0 && !confirm(`ต้องการลบผู้ใช้ "${userName}" ใช่หรือไม่? ข้อมูลนี้กู้คืนไม่ได้`)) {
            e.preventDefault();
          }
        }}
      >
        ลบผู้ใช้
      </Button>
    </>
  );
}
