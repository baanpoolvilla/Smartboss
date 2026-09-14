"use client";

import { Button } from "@smartboss/ui/components/button";

/** เปิดหน้าต่างพิมพ์ของเบราว์เซอร์ — เลือก "บันทึกเป็น PDF" ได้จากหน้าต่างเดียวกัน */
export function PrintButton() {
  return (
    <Button type="button" onClick={() => window.print()}>
      พิมพ์ / บันทึก PDF
    </Button>
  );
}
