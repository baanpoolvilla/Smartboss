import "server-only";
import { randomBytes } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Storage abstraction — เลือก backend จาก env อัตโนมัติ
 *   - ตั้ง S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY → object storage
 *     (Cloudflare R2 / AWS S3 / MinIO / Supabase Storage — S3-compatible ทุกตัว)
 *   - ไม่ตั้ง → local disk (dev). Vercel เขียน disk ไม่ได้ prod จึง **ต้อง** ตั้ง S3_*
 *
 * ทุก backend คืน URL รูปแบบเดียวกัน `/api/files/<key>` เพื่อให้แถวใน DB
 * ไม่ผูกกับ backend — ย้าย backend แล้วข้อมูลเดิมยังใช้ได้
 * route นั้นเช็ค session ก่อนแล้วค่อย 302 ไป presigned URL (ดู app/api/files)
 *
 * ⚠ อยู่ที่ apps/web/lib/ ไม่ใช่ใต้ modules/<โมดูล>/ โดยตั้งใจ — สามโมดูลใช้ร่วมกัน
 * (maintenance · report_task · chat) ถ้าไปวางใต้โมดูลใดโมดูลหนึ่งจะกลายเป็น
 * โมดูลอ้างของกันเอง ซึ่งผิดสัญญาโมดูลที่วางไว้
 *
 * ⚠ โค้ดฝั่ง local disk อยู่คนละไฟล์และโหลดแบบ dynamic — ดูเหตุผลใน local-disk.ts
 */

const S3_BUCKET = process.env.S3_BUCKET;
const S3_ENDPOINT = process.env.S3_ENDPOINT; // R2: https://<account_id>.r2.cloudflarestorage.com
const S3_REGION = process.env.S3_REGION || "auto"; // R2 ใช้ "auto"
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;

/** อายุ presigned URL — สั้นพอที่ลิงก์หลุดไปแล้วใช้ต่อไม่ได้ แต่ยาวพอให้โหลดแกลเลอรีจบ */
const SIGNED_URL_TTL_SECONDS = 300;

const IMG_EXT = new Set(["jpg", "jpeg", "png", "webp", "heic", "gif"]);

/** prod ใช้ object storage หรือไม่ */
export function isRemoteStorage(): boolean {
  return Boolean(S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY);
}

/**
 * โหลดโหมด local disk ตอนใช้จริงเท่านั้น — production (ตั้ง S3_* ไว้) ไม่เคยเรียก
 *
 * ⚠ **ห้ามใส่ turbopackIgnore ตรงนี้** ถึงแม้จะลดขนาด NFT ได้ครึ่งหนึ่งก็ตาม
 * ลองมาแล้ว: รายชื่อไฟล์ต่อ route ลดจาก 982 เหลือ 484 และคำเตือนหายหมด
 * แต่ Turbopack จะไม่ emit ./local-disk ออกมาเลย เหลือแต่ import() ลอย ๆ ใน
 * chunk ที่ resolve ไม่เจอ ⇒ โหมด local disk (ซึ่งคือเครื่อง dev ทุกเครื่อง) พัง
 * โดยที่ readStoredFile กับ deleteFile กลืน error ไว้ใน try/catch ⇒ รูปหาย 404
 * เงียบ ๆ หาสาเหตุไม่เจอ
 */
function localDisk() {
  return import("./local-disk");
}

let s3: S3Client | null = null;

function getS3(): S3Client {
  if (s3) return s3;
  s3 = new S3Client({
    region: S3_REGION,
    // AWS S3 แท้ ๆ ไม่ต้องตั้ง endpoint (SDK เดาจาก region เอง)
    ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {}),
    // SDK v3 default = virtual-host style (https://<bucket>.<endpoint>/<key>)
    // MinIO/R2 ต้องใช้ path-style (https://<endpoint>/<bucket>/<key>) ไม่งั้น
    // presigned URL จะชี้ไป subdomain ที่ไม่มีอยู่ → DNS ไม่รู้จัก/cert ไม่ตรง
    ...(S3_ENDPOINT ? { forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID as string,
      secretAccessKey: S3_SECRET_ACCESS_KEY as string,
    },
  });
  return s3;
}

function safeExt(name: string): string {
  const e = name.split(".").pop()?.toLowerCase() ?? "jpg";
  return IMG_EXT.has(e) ? e : "jpg";
}

function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain; charset=utf-8";
    case "zip":
      return "application/zip";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    // เอกสารออฟฟิศ — ต้องมีที่นี่ให้ครบ ไม่งั้นตกไป default "image/jpeg" ด้านล่าง
    // แล้วเปิดไม่ได้เลย (เพิ่มไว้ให้โมดูลไฟล์บริษัทที่รับไฟล์พวกนี้โดยเฉพาะ)
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    default:
      return "image/jpeg";
  }
}

/**
 * อัปโหลดไฟล์ คืน URL (/api/files/<key>)
 *
 * `opts.ext` มีไว้ให้ผู้เรียกที่ **ตรวจชนิดไฟล์จากเนื้อไฟล์จริงมาแล้ว** กำหนดนามสกุลเอง
 * — โดยปริยาย safeExt() รู้จักแต่รูปภาพ (ตอนเขียนมีแต่โมดูลซ่อมบำรุงใช้) อย่างอื่น
 * ตกเป็น .jpg หมด ซึ่งทำให้ pdf/txt/zip ถูกเสิร์ฟกลับเป็น image/jpeg แล้วเปิดไม่ได้
 * ⚠ อย่าเอา file.name จาก client มาใส่ตรง ๆ — เท่ากับให้คนอัปโหลดเลือก
 *   Content-Type ที่ปลายทางจะเสิร์ฟได้เอง
 */
export async function putFile(
  prefix: string,
  file: File,
  opts?: { ext?: string }
): Promise<string> {
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = opts?.ext ?? safeExt(file.name);
  const key = `${prefix}/${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;

  if (isRemoteStorage()) {
    await getS3().send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: buf,
        ContentType: contentTypeFor(key),
      })
    );
  } else {
    await (await localDisk()).writeLocal(key, buf);
  }

  return `/api/files/${key}`;
}

/** อัปโหลดหลายไฟล์ (ข้ามไฟล์ว่าง) */
export async function putFiles(prefix: string, files: File[]): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) {
    if (!f || typeof f.arrayBuffer !== "function" || f.size === 0) continue;
    urls.push(await putFile(prefix, f));
  }
  return urls;
}

/**
 * presigned URL สำหรับดาวน์โหลดตรงจาก object storage (หมดอายุใน 5 นาที)
 * คืน null เมื่อรันโหมด local disk — ผู้เรียกต้อง fallback ไป readStoredFile
 */
export async function getSignedFileUrl(key: string): Promise<string | null> {
  if (!isRemoteStorage()) return null;
  return getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    { expiresIn: SIGNED_URL_TTL_SECONDS }
  );
}

/**
 * ลบไฟล์ที่ไม่มีใครอ้างถึงแล้ว — รับได้ทั้ง key ล้วนและ URL `/api/files/<key>`
 *
 * **ไม่โยน error เมื่อลบไม่ได้** โดยตั้งใจ: ผู้เรียกมักลบไฟล์หลังลบแถวในฐานข้อมูล
 * สำเร็จแล้ว ถ้าปล่อยให้ล้มตรงนี้ ผู้ใช้จะเห็น error ทั้งที่สิ่งที่เขาสั่ง (ลบคอมเมนต์)
 * ทำสำเร็จไปแล้ว · ผลเสียของไฟล์ค้างคือเปลืองพื้นที่ ซึ่งเบากว่าการทำให้ผู้ใช้สับสน
 *
 * @returns true = ลบแล้ว · false = ลบไม่ได้ (ไฟล์ค้างอยู่ ไม่มีผลกับข้อมูล)
 */
export async function deleteFile(urlOrKey: string): Promise<boolean> {
  const key = urlOrKey.replace(/^\/api\/files\//, "");
  if (!key || key.includes("..")) return false;

  try {
    if (isRemoteStorage()) {
      await getS3().send(
        new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key })
      );
      return true;
    }
    return await (await localDisk()).deleteLocal(key);
  } catch {
    return false;
  }
}

/** ลบหลายไฟล์ — คืนจำนวนที่ลบสำเร็จ */
export async function deleteFiles(urlsOrKeys: string[]): Promise<number> {
  let n = 0;
  for (const u of urlsOrKeys) if (await deleteFile(u)) n++;
  return n;
}

/** อ่านไฟล์จาก local disk (โหมด dev เท่านั้น) */
export async function readStoredFile(
  key: string
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const data = await (await localDisk()).readLocal(key);
    if (!data) return null;
    return { data, contentType: contentTypeFor(key) };
  } catch {
    return null;
  }
}
