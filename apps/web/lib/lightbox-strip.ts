/**
 * แถบรูปย่อของตัวดูรูปทั้งสองตัว (แชท/ซ่อมบำรุง = lightbox.tsx, รีพอต/งาน = report-image-lightbox.tsx)
 * เมาส์: ย่อเหลือป้าย "1 / 3" ไม่บังรูป ชี้หรือกด Tab เข้าไปแล้วรูปย่อค่อยโผล่ (ผู้ใช้ 3/11/2569)
 * ใช้ focus-visible ไม่ใช่ focus-within — กดรูปย่อด้วยเมาส์แล้วปุ่มถือโฟกัสค้าง เอาเมาส์ออกแถบจะไม่ย่อกลับ
 * จอสัมผัสไม่มีการชี้ ⇒ แสดงตลอดเหมือนเดิม แตะรูปเพื่อซ่อน
 */
export const THUMB_STRIP_PILL =
  "group/strip [@media(pointer:fine)]:gap-0 [@media(pointer:fine)]:hover:gap-2.5 [@media(pointer:fine)]:has-[:focus-visible]:gap-2.5 before:absolute before:-inset-6 before:content-['']";

export const THUMB_STRIP_ROW =
  "transition-all duration-200 [@media(pointer:fine)]:max-h-0 [@media(pointer:fine)]:max-w-0 [@media(pointer:fine)]:overflow-hidden [@media(pointer:fine)]:py-0 [@media(pointer:fine)]:opacity-0 [@media(pointer:fine)]:group-hover/strip:max-h-16 [@media(pointer:fine)]:group-hover/strip:max-w-[60vw] [@media(pointer:fine)]:group-hover/strip:overflow-x-auto [@media(pointer:fine)]:group-hover/strip:py-1 [@media(pointer:fine)]:group-hover/strip:opacity-100 [@media(pointer:fine)]:group-has-[:focus-visible]/strip:max-h-16 [@media(pointer:fine)]:group-has-[:focus-visible]/strip:max-w-[60vw] [@media(pointer:fine)]:group-has-[:focus-visible]/strip:overflow-x-auto [@media(pointer:fine)]:group-has-[:focus-visible]/strip:py-1 [@media(pointer:fine)]:group-has-[:focus-visible]/strip:opacity-100";

/** รอแถบกางเสร็จ (duration-200) ค่อยเลื่อนรูปที่เปิดอยู่มาไว้กลางแถบ — ตอนย่อแถบกว้าง 0 เลื่อนไม่ถูกตำแหน่ง */
export const THUMB_STRIP_EXPAND_MS = 220;
