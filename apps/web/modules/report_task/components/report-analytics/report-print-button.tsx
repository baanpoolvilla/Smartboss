"use client";

import { Button } from "@/modules/report_task/components/ui/button";
import { Printer } from "lucide-react";

/** Browser print dialog doubles as "export to PDF" via its own Save-as-PDF option. */
export function ReportPrintButton() {
  return (
    <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}>
      <Printer className="h-3.5 w-3.5" /> พิมพ์ / บันทึกเป็น PDF
    </Button>
  );
}
