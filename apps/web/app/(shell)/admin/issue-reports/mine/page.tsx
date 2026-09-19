import { renderIssueReportsPage } from "../page";

export const dynamic = "force-dynamic";

/**
 * เมนูย่อย "ตั๋วของฉัน" ในไซด์บาร์ "แจ้งบัค" — Super Admin เห็นเฉพาะตั๋วที่
 * ตัวเองเป็นคนแจ้งเอง (กันลืมเรื่องที่ตัวเองเจอปัญหาแล้วแจ้งไว้) ใช้เนื้อหา
 * เดียวกับ /admin/issue-reports เป๊ะ แค่ล็อก tab ไว้ที่ "mine" เสมอและซ่อน
 * แถบแท็บ (ดู renderIssueReportsPage ใน page.tsx ตัวจริง)
 */
export default async function MyIssueReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return renderIssueReportsPage(await searchParams, { forcedTab: "mine", hideTabSwitcher: true });
}
