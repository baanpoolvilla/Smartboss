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
        // การ์ดอ่านง่าย: หัวข้อเข้ม ตัวหนา · รายละเอียดเทาเข้ม ไม่เกิน 3 บรรทัด · ปุ่ม "เปิด" สีแบรนด์
        // (Tailwind v4 — "!" ท้ายคลาส = !important ชนะสไตล์ตั้งต้นของ sonner)
        classNames: {
          toast:
            "cn-toast rounded-2xl! border-[#e5e7eb]! bg-white! px-4! py-3.5! shadow-[0_12px_32px_rgba(15,23,42,0.14)]!",
          title: "text-[14.5px]! font-semibold! leading-snug! text-[#0f172a]!",
          description: "mt-0.5! line-clamp-3 text-[13.5px]! leading-relaxed! text-[#334155]!",
          actionButton:
            "h-8! rounded-lg! bg-[#16a34a]! px-3.5! text-[13px]! font-semibold! text-white! hover:bg-[#15803d]!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
