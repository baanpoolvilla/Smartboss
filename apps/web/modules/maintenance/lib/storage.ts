/**
 * ย้ายไปเป็นของกลางที่ @/lib/storage แล้ว — คง re-export ไว้ให้ import เดิมใช้ได้
 *
 * ย้ายเพราะสามโมดูลใช้ร่วมกัน (maintenance · report_task · chat) การให้ไฟล์นี้
 * อยู่ใต้ modules/maintenance/ ทำให้อีกสองโมดูลต้อง import ข้ามโมดูล ซึ่งผิด
 * สัญญาโมดูลที่วางไว้ (ดู docs/branches.md)
 */
export {
  isRemoteStorage,
  putFile,
  putFiles,
  getSignedFileUrl,
  deleteFile,
  deleteFiles,
  readStoredFile,
} from "@/lib/storage";
