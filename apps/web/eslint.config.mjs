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
      // โค้ดที่ยกมาจากแอป easyboss-workspace — ยังไม่ได้ปรับสไตล์ให้ตรงกับที่นี่
      // ปลดออกเมื่อเขียนชั้นข้อมูลใหม่เสร็จ
      "modules/report_task/**",
      "app/(shell)/report-task/**",
      "app/api/report-task/**",
    ],
  },
  ...(Array.isArray(nextCoreWebVitals) ? nextCoreWebVitals : [nextCoreWebVitals]),
];

export default config;
