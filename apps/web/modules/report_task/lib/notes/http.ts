import "server-only";
import { NextResponse } from "next/server";

import { NoteError } from "./server";

/** ข้อผิดพลาดของโน้ต → ข้อความภาษาคน + สถานะ HTTP · อย่างอื่นไม่เปิดเผยรายละเอียด */
export function noteError(error: unknown) {
  if (error instanceof NoteError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[notes]", error);
  return NextResponse.json({ error: "ทำไม่สำเร็จ ลองใหม่อีกครั้ง" }, { status: 500 });
}
