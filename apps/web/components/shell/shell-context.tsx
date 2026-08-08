"use client";

import { createContext, useContext } from "react";

export interface ShellUser {
  name: string;
  email: string;
  avatarUrl: string | null;
  roleLabel: string;
}

interface ShellContextValue {
  user: ShellUser;
  unread: number;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function ShellProvider({
  user,
  unread,
  children,
}: ShellContextValue & { children: React.ReactNode }) {
  return (
    <ShellContext.Provider value={{ user, unread }}>
      {children}
    </ShellContext.Provider>
  );
}

/**
 * ให้ AppBar ของโมดูล (เช่น กระดิ่งแจ้งเตือน) ใช้ข้อมูลชุดเดียวกับ Shell
 * โดยไม่ต้อง query ซ้ำในทุกหน้า — Shell โหลดมาแล้วครั้งเดียวที่ layout
 */
export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell ต้องอยู่ภายใน <ShellProvider>");
  return value;
}
