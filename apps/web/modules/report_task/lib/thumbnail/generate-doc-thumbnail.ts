import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { freemem, tmpdir } from "node:os";
import { join } from "node:path";

import { needsOfficeConversion, supportsDocThumbnail } from "./thumbnail-support";

export { supportsDocThumbnail };

const execFileAsync = promisify(execFile);

/**
 * สร้างภาพหน้าแรกของ pdf/word/excel/ppt ไว้แสดงแทนไอคอนเฉย ๆ (ดูแผนเต็มที่
 * docs/attachment-thumbnail-plan-2026-09-14.md) — **best effort ล้วน ๆ**
 * ห้าม throw ออกไปทำให้การอัปโหลดไฟล์จริงพังตามไปด้วยเด็ดขาด ผู้เรียก
 * (upload route) เจอ null แล้วต้องแค่ข้าม thumbUrl ไป ไม่ใช่ fail ทั้งคำขอ
 *
 * เครื่อง prod เป็น e2-medium (2 vCPU / 4GB) ที่ตึงอยู่แล้วแม้สภาพปกติ
 * (`next build` เองยังต้องระวัง OOM) จึงรัดกุมเป็นพิเศษกว่าปกติ:
 *   - แปลงได้ทีละ 1 งานทั้งเซิร์ฟเวอร์ (ทุก org รวมกัน) — งานที่สองที่มาซ้อน
 *     ระหว่างงานแรกกำลังรัน **ข้ามไปเลยทันที ไม่ต่อคิว** เพื่อไม่ให้คำขอ
 *     อัปโหลดต้องรอนานขึ้นเรื่อย ๆ ตอนมีคนใช้พร้อมกันหลายคน (แลกกับ:
 *     บางไฟล์ในช่วงนั้นจะไม่มี thumbnail — fallback การ์ดไอคอนเดิมรับไว้)
 *   - เช็ก free memory ก่อนเริ่มทุกครั้ง ต่ำกว่าเกณฑ์ก็ข้ามเลยเหมือนกัน
 *
 * ── PDF รอคิวสั้น ๆ แทนการข้าม ──
 * เปิดหน้าที่มี PDF หลายไฟล์จะขอรูปพร้อมกันหลายคำขอ (ดู doc-thumbnail route) ถ้าข้ามทันที
 * จะได้รูปแค่ไฟล์แรก PDF ใช้เวลาไม่ถึงวินาทีจึงรอได้ ยังทำทีละงานเหมือนเดิม
 * office ยังข้ามทันทีเหมือนเดิม
 *
 * ⚠ ต้องติดตั้ง poppler-utils (pdftoppm) และ libreoffice (soffice) บนเซิร์ฟเวอร์
 * ไม่มีจะไม่มีรูปเลยโดยหน้าเว็บไม่ฟ้อง — log ขึ้น `spawn pdftoppm ENOENT` (เช็กด้วย deploy/check-vm.sh)
 */
const MIN_FREE_MEM_BYTES = 600 * 1024 * 1024;
const MAX_PDF_WAITERS = 10;
const SOFFICE_TIMEOUT_MS = 20_000;
const PDFTOPPM_TIMEOUT_MS = 10_000;

let busy = false;
/** PDF ที่รอคิวอยู่ — ตอนปล่อยงานจะส่ง "busy" ต่อให้คนแรกในคิวเลย ไม่ปล่อยให้ว่างก่อน */
const pdfWaiters: Array<() => void> = [];

async function acquire(ext: string): Promise<boolean> {
  if (!busy) {
    busy = true;
    return true;
  }
  if (ext !== "pdf" || pdfWaiters.length >= MAX_PDF_WAITERS) return false;
  await new Promise<void>((resolve) => pdfWaiters.push(resolve));
  return true;
}

function release() {
  const next = pdfWaiters.shift();
  if (next) next();
  else busy = false;
}

export async function generateDocThumbnail(bytes: Uint8Array, ext: string): Promise<Buffer | null> {
  if (!supportsDocThumbnail(ext)) return null;
  if (!(await acquire(ext))) {
    console.warn("[doc-thumbnail] ข้าม — มีงานแปลงอื่นกำลังทำอยู่แล้ว (concurrency จำกัดไว้ที่ 1)");
    return null;
  }
  try {
    if (freemem() < MIN_FREE_MEM_BYTES) {
      console.warn("[doc-thumbnail] ข้าม — free memory ต่ำกว่าเกณฑ์");
      return null;
    }
    return await renderThumbnail(bytes, ext);
  } catch (err) {
    // ครอบคลุมทุกสาเหตุ: ไม่มี soffice/pdftoppm ติดตั้ง, timeout, ไฟล์เสีย,
    // exit code ผิด — ผู้เรียกเห็นแค่ null เหมือนกันหมด ไม่สนใจสาเหตุ
    console.error("[doc-thumbnail] แปลงไม่สำเร็จ", err);
    return null;
  } finally {
    release();
  }
}

async function renderThumbnail(bytes: Uint8Array, ext: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "report-thumb-"));
  try {
    const inputPath = join(dir, `in.${ext}`);
    await writeFile(inputPath, bytes);

    let pdfPath = inputPath;
    if (needsOfficeConversion(ext)) {
      await execFileAsync(
        "soffice",
        [
          "--headless",
          "--norestore",
          // profile แยกต่อการแปลง — soffice หลายอันพร้อมกันแย่ง lock โปรไฟล์
          // เดียวกันจะ error (ปัญหารู้กันดีของ LibreOffice headless) แม้จะ
          // จำกัด concurrency ไว้ที่ 1 แล้วก็ตาม ใส่ไว้กันเหนียวเผื่อมีของเก่า
          // ค้างจาก process ที่ถูกฆ่าไปก่อนหน้า
          `-env:UserInstallation=file://${join(dir, "lo-profile")}`,
          "--convert-to",
          "pdf",
          "--outdir",
          dir,
          inputPath,
        ],
        { timeout: SOFFICE_TIMEOUT_MS, killSignal: "SIGKILL" }
      );
      pdfPath = join(dir, "in.pdf");
    }

    const outPrefix = join(dir, "page");
    await execFileAsync(
      "pdftoppm",
      ["-png", "-f", "1", "-l", "1", "-scale-to", "720", pdfPath, outPrefix],
      { timeout: PDFTOPPM_TIMEOUT_MS, killSignal: "SIGKILL" }
    );

    // ไม่ hardcode ชื่อไฟล์ผลลัพธ์เป็น "page-1.png" ตรง ๆ — pdftoppm ใส่เลข
    // หน้าโดยเติมศูนย์ตามจำนวนหน้ารวมของเอกสารต้นทาง (ไม่ใช่ตามช่วงที่ขอ)
    // เอกสารที่มีมากกว่า 9 หน้าจะได้ "page-01.png" ถึง "page-001.png" ถ้าเกิน
    // 99 หน้า — หาไฟล์จริงในโฟลเดอร์แทนการเดาชื่อ
    const files = await readdir(dir);
    const pageFile = files.find((f) => f.startsWith("page-") && f.endsWith(".png"));
    if (!pageFile) throw new Error("pdftoppm ไม่ได้สร้างไฟล์ผลลัพธ์");
    return await readFile(join(dir, pageFile));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
