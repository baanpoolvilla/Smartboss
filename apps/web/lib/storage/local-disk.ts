import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * โหมดเก็บไฟล์ลงดิสก์ — **สำหรับเครื่อง dev เท่านั้น**
 *
 * production ตั้ง S3_* ไว้ครบ (ดู deploy/init-env.sh) จึงไม่เคยแตะไฟล์นี้เลย
 * แต่ .env.example ตั้ง S3_BUCKET= ว่างไว้ ⇒ เครื่อง dev ทุกคนวิ่งทางนี้
 *
 * ⚠ แยกออกมาเป็นไฟล์ต่างหากโดยตั้งใจ ห้ามยุบกลับเข้า index.ts
 *
 * Next ไล่ dependency แบบ static เพื่อทำรายชื่อไฟล์ที่แต่ละ route ต้องใช้ (NFT)
 * พอเจอ fs.readFile ที่รับ path ซึ่งคำนวณตอนรัน มันเดาไม่ออกว่าจะอ่านไฟล์ไหน
 * เลยเหมาว่า "ต้องใช้ทั้งโปรเจกต์" — ทุก route ที่แตะเรื่องไฟล์เลยบวมจาก ~330
 * เป็น ~950 ไฟล์ รวมถึงหน้าล็อกอินกับโมดูลแชทที่ไม่เกี่ยวอะไรด้วยเลย
 *
 * index.ts จึง import ไฟล์นี้แบบ dynamic เฉพาะตอนที่ไม่ได้ตั้ง S3 จริง ๆ
 */

function uploadDir(): string {
  return process.env.UPLOAD_DIR || path.join(process.cwd(), ".uploads");
}

/**
 * แปลง key เป็น path เต็ม — คืน null ถ้าหลุดออกนอกโฟลเดอร์อัปโหลด
 *
 * กัน path traversal: key มาจาก URL (`/api/files/<key>`) ผู้ใช้ยิง `../../etc/passwd`
 * เข้ามาได้ ต้อง resolve แล้วเทียบว่ายังอยู่ใต้ base จริงก่อนแตะดิสก์เสมอ
 */
function safePath(key: string): string | null {
  const base = path.resolve(uploadDir());
  const full = path.resolve(path.join(uploadDir(), key));
  return full.startsWith(base) ? full : null;
}

export async function writeLocal(key: string, buf: Buffer): Promise<void> {
  const full = path.join(uploadDir(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
}

export async function deleteLocal(key: string): Promise<boolean> {
  const full = safePath(key);
  if (!full) return false;
  await fs.unlink(full);
  return true;
}

/** คืน null เมื่อไม่มีไฟล์ หรือ key พยายามหลุดออกนอกโฟลเดอร์ */
export async function readLocal(key: string): Promise<Buffer | null> {
  const full = safePath(key);
  if (!full) return null;
  return fs.readFile(full);
}

/** ไฟล์ทั้งหมดใต้ prefix (เดินโฟลเดอร์ย่อยทั้งหมด) — ใช้นับพื้นที่ตามระบบ (หน้า admin/storage) */
export async function listLocal(prefix: string): Promise<{ key: string; size: number; lastModified: Date }[]> {
  const root = safePath(prefix);
  if (!root) return [];
  const base = path.resolve(uploadDir());
  const out: { key: string; size: number; lastModified: Date }[] = [];
  async function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // ไม่มีโฟลเดอร์ = ยังไม่มีไฟล์
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const st = await fs.stat(full);
        out.push({ key: path.relative(base, full).split(path.sep).join("/"), size: st.size, lastModified: st.mtime });
      }
    }
  }
  await walk(root);
  return out;
}
