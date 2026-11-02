import { create } from "zustand";

/** ผู้ใช้เปิดใบแจ้งซ่อมจากรีพอตได้ไหม — layout ฝั่งเซิร์ฟเวอร์ตรวจสิทธิ์และโมดูลแล้วส่งมาให้ */
export const useWorkOrderAccessStore = create<{ canOpen: boolean }>(() => ({ canOpen: false }));
