import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("รูปแบบอีเมลไม่ถูกต้อง"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน").max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
