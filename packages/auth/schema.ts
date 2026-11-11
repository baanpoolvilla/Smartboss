import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("รูปแบบอีเมลไม่ถูกต้อง"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน").max(200),
  /** รหัส 6 หลักจากแอป Authenticator หรือรหัสสำรอง — ส่งมาเฉพาะบัญชีที่เปิดยืนยันตัวตน 2 ชั้น */
  code: z.string().trim().max(20).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
