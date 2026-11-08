"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_CEO_TITLE } from "@/lib/ceo-title-shared";

/** ชื่อเรียกตำแหน่งสูงสุดของบริษัทฝั่งเบราว์เซอร์ — ใส่ค่าที่ layout ของ shell (ดู lib/ceo-title.ts) */
const CeoTitleContext = createContext<string>(DEFAULT_CEO_TITLE);

export function CeoTitleProvider({ title, children }: { title: string; children: ReactNode }) {
  return <CeoTitleContext.Provider value={title}>{children}</CeoTitleContext.Provider>;
}

export function useCeoTitle(): string {
  return useContext(CeoTitleContext);
}
