"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useReportFeedStore } from "@/modules/report_task/store/report-feed-store";
import { OUTBOX_MAX_AGE_MS, readOutbox, writeOutbox } from "./report-outbox-storage";

/**
 * กล่องรอส่งของโพสต์รายงาน — เก็บโพสต์ใหม่ไว้ในเครื่องจนกว่าจะแน่ใจว่าถึงเซิร์ฟเวอร์ แล้วใส่กลับถ้าหน้าโหลดใหม่ตัดกลาง
 *
 * เกิดจริง: พิมพ์รีพอตค้างไว้ → มีการ deploy → กดโพสต์ → โพสต์ขึ้นแล้ว "เด้งหาย" → ระบบนับว่าไม่ส่ง หักคะแนน
 * ต้นเหตุ: หลัง deploy หน้าเว็บที่ยังเป็นโค้ดเก่าโดน Next.js โหลดหน้าใหม่ทั้งหน้าตอนคุยกับเซิร์ฟเวอร์ครั้งแรก ถ้าจังหวะ
 * นั้นตกช่วงที่โพสต์ยังรอบันทึก (หน่วง 500ms / กำลังส่ง / รอลองใหม่) ของก็หาย — ตอนปิดหน้าส่งได้แค่แบบ keepalive
 * ซึ่งรับไม่เกิน ~64KB ฟีดรีพอตใหญ่หลาย MB (server-store-sync.tsx flushOnUnload) และร่างในช่องพิมพ์ก็ถูกล้างไปแล้ว
 * ตอนกดโพสต์
 *
 * กติกา: ทุกโพสต์ใหม่ลงกล่องนี้ (localStorage — อยู่รอดการโหลดหน้าใหม่/ปิดแอป) · ตอนเปิดแอปแล้วโหลดฟีดจาก
 * เซิร์ฟเวอร์เสร็จครั้งแรก: โพสต์ที่เซิร์ฟเวอร์มีแล้ว = ทิ้งจากกล่อง · ยังไม่มี = ใส่กลับเข้าฟีด (ตัวซิงก์บันทึกให้เอง)
 * ลบโพสต์เอง = เอาออกจากกล่องด้วย (ไม่งั้นโหลดใหม่แล้วฟื้นขึ้นมา) · ค้างเกิน 24 ชม. = ทิ้ง
 */

/** เทียบกับฟีดที่เพิ่งโหลดจากเซิร์ฟเวอร์ — ต้องเรียกตอนที่ store ยังเป็นข้อมูลเซิร์ฟเวอร์ล้วน (โหลดครั้งแรก) */
function reconcile() {
  const list = readOutbox();
  if (list.length === 0) return;
  const now = Date.now();
  const { posts, topics } = useReportFeedStore.getState();
  const onServer = new Set(posts.map((p) => p.id));
  const topicIds = new Set(topics.map((t) => t.id));
  const missing = list.filter((e) => now - e.at < OUTBOX_MAX_AGE_MS && !onServer.has(e.post.id) && topicIds.has(e.post.topicId));
  writeOutbox(missing); // ถึงเซิร์ฟเวอร์แล้ว/เก่าเกิน/ห้องถูกลบ = ทิ้ง · ที่ใส่กลับยังเก็บไว้จนรอบหน้าเห็นว่าถึงแล้ว
  if (missing.length === 0) return;
  useReportFeedStore.setState((s) => ({ posts: [...s.posts, ...missing.map((e) => e.post)] }));
  toast.success(
    missing.length === 1
      ? `กู้โพสต์ "${missing[0]!.post.title}" ที่ยังส่งไม่ถึงระบบกลับมาแล้ว กำลังบันทึกให้`
      : `กู้โพสต์ ${missing.length} รายการที่ยังส่งไม่ถึงระบบกลับมาแล้ว กำลังบันทึกให้`,
    { duration: 6000 }
  );
}

/** ครั้งเดียวต่อการโหลดหน้า — เข้าออกโมดูลในแอปแล้วกลับมา ฟีดในหน่วยความจำมีโพสต์ที่ยังไม่บันทึกปนอยู่ได้ ห้ามใช้ตัดสิน */
let reconciledThisPage = false;

/** วางคู่กับ ServerStoreSync ของ report-feed — ทำงานครั้งเดียวต่อการเปิดหน้า หลังโหลดฟีดจากเซิร์ฟเวอร์เสร็จ */
export function ReportOutboxReconciler() {
  useEffect(() => {
    const run = () => {
      if (reconciledThisPage || !useReportFeedStore.getState().loaded) return;
      reconciledThisPage = true;
      // รอให้ตัวซิงก์จดฐานข้อมูลเซิร์ฟเวอร์ (base) เสร็จก่อน ไม่งั้นการใส่กลับถูกมองเป็นข้อมูลเซิร์ฟเวอร์ ไม่ถูกบันทึก
      setTimeout(reconcile, 0);
    };
    run();
    return useReportFeedStore.subscribe(run);
  }, []);
  return null;
}
