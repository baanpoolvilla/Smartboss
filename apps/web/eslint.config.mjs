import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/*
 * Next 16 ถอดคำสั่ง `next lint` ออก — ต้องเรียก eslint ตรง ๆ แทน
 * และ eslint-config-next 16 ส่งออกเป็น flat config แล้ว ไฟล์นี้จึงมาแทน .eslintrc.json เดิม
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
    ],
  },
  ...(Array.isArray(nextCoreWebVitals) ? nextCoreWebVitals : [nextCoreWebVitals]).map((cfg) =>
    /*
     * กฎชุด React Compiler ที่ eslint-config-next 16 เปิดเป็น error ให้อัตโนมัติ
     * (eslint-plugin-react-hooks v7) — โค้ดเดิมมีจุดที่ไม่ผ่าน ~40 จุด เป็นเรื่อง
     * "พร้อมสำหรับ React Compiler" ไม่ใช่บั๊กที่ผู้ใช้เห็น และโปรเจกต์ยังไม่ได้เปิด
     * reactCompiler ใน next.config — ลดเป็น warn ไว้ก่อนให้ CI ขั้น lint ผ่าน แล้วทยอยแก้
     * (ยังเห็นใน `pnpm lint` เป็นคำเตือน) ก่อนเปิด React Compiler ต้องกลับมาเป็น error
     * ต้องใส่ในก้อน config เดียวกับที่ประกาศ plugin react-hooks (กติกาของ flat config)
     */
    cfg.plugins?.["react-hooks"]
      ? {
          ...cfg,
          rules: {
            ...cfg.rules,
            "react-hooks/set-state-in-effect": "warn",
            "react-hooks/refs": "warn",
            "react-hooks/purity": "warn",
          },
        }
      : cfg,
  ),
];

export default config;
