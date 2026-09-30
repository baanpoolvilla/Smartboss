"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * เว็บมีแต่ธีมสว่าง (ไม่มี ThemeProvider) — เดิมส่ง theme จาก next-themes ซึ่งได้ "system"
 * เครื่องที่ตั้งโหมดมืดไว้ sonner เลยใช้สีตัวหนังสือของธีมมืด (เทาอ่อนมาก) บนพื้นขาวของเรา
 * ข้อความในกล่องเด้งแจ้งเตือนเกือบมองไม่เห็น — ล็อกเป็นสว่าง + กำหนดสีรายละเอียดให้เข้มเอง
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          title: "!text-[#111827] !font-semibold",
          description: "!text-[#374151]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
