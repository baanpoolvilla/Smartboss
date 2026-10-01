import { PageLoading } from "@/components/shell/page-loading";

// แถบบน/เมนูของโมดูลอยู่ใน layout — ระหว่างโหลดหน้าใหม่ให้เนื้อหาขึ้นเป็นโครงทันที
export default function Loading() {
  return <PageLoading />;
}
