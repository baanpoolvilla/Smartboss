# สเปก: จัดระเบียบไฟล์/รูป/เอกสาร/ลิงก์ ในห้องรายงาน (report-feed)

> เอกสารนี้เขียนไว้ให้ Claude Code ทำตามได้เลย ทุกหัวข้อมี **ไฟล์ที่เกี่ยว / สภาพปัจจุบัน / สิ่งที่ต้องการ / เกณฑ์ผ่าน**
> repo: `Smartboss` · โมดูล: `apps/web/modules/report_task` + `apps/web/modules/company-files`
> เขียนเมื่อ 2026-09-03

---

## 0. บริบท

ในห้องรายงานแต่ละห้อง (report-feed) มีแท็บด้านบน: **โพสต์ · ไฟล์ · รูปภาพ · ลิงก์ · สรุป**
ปัญหาที่ผู้ใช้เจอ:

1. **ชื่อแท็บไม่ตรงกับเนื้อหา** — แท็บ "ไฟล์" จริง ๆ แสดง *รูปล่าสุด 7 วัน*, แท็บ "รูปภาพ" จริง ๆ คือ *อัลบั้ม* → งงว่าอันไหนคืออะไร
2. **แนบได้แค่รูป/วิดีโอ** — pdf / word / excel แนบในโพสต์ไม่ได้เลย จึงไม่มีทางเก็บเข้าเอกสารห้อง
3. **ลิงก์หาย** — ลิงก์ที่แปะในโพสต์ถูกรวบมาที่แท็บ "ลิงก์" แบบ auto เท่านั้น ปักหมุด/ตั้งชื่อ/ค้นหาไม่ได้ แปะแล้วหาทีหลังไม่เจอ
4. เอกสารบริษัท ("เอกสารของห้องนี้") ไปแสดงอยู่บนสุดของแท็บ "ไฟล์" ยิ่งสับสน

**งานที่ทำไปแล้ว (อ้างอิง):** commit `841d517` เพิ่มปุ่ม `SaveToDocumentsButton` ที่มุมขวาบนของรูปในแท็บ "ไฟล์" → กดแล้วเพิ่มรูปนั้นเข้า "เอกสารของห้องนี้" (company-files) โดยชี้ storage url เดิม ไม่อัปโหลดใหม่ สเปกนี้ต่อยอดจากตรงนั้น **ห้ามรื้อของเดิมที่ทำงานถูกแล้ว**

---

## 1. แผนที่ไฟล์ (อ่านก่อนเริ่ม)

| เรื่อง | ไฟล์ |
|---|---|
| นิยามแท็บ (`topicTabs`) | `apps/web/app/(shell)/report-task/report-feed/page.tsx` (~บรรทัด 65–71) |
| พาเนลของแต่ละแท็บ + `collectFiles` / `collectLinks` / `FILES_TAB_WINDOW_DAYS` | `apps/web/modules/report_task/components/report-feed/report-topic-panels.tsx` |
| กล่อง "เอกสารของห้องนี้" | `apps/web/modules/report_task/components/report-feed/report-topic-documents.tsx` |
| ปุ่มเพิ่มเข้าเอกสาร (มีแล้ว) | `apps/web/modules/report_task/components/report-feed/save-to-documents-button.tsx` |
| ปุ่มเก็บเข้าอัลบั้ม | `apps/web/modules/report_task/components/report-feed/album-picker-button.tsx` |
| ช่องเขียนโพสต์ + input แนบไฟล์ (`accept=`) | `apps/web/modules/report_task/components/report-feed/openchat-feed.tsx` (~บรรทัด 776) |
| ชนิดข้อมูลโพสต์ (`ReportPost`, `ReportPostImage`) | `apps/web/modules/report_task/store/report-feed-store.ts` |
| ชั้นข้อมูล company-files (`addFileToRoomFolder`, `createFile`, `listRoomFiles`, `createShareLink`, `addFileVersion`, โฟลเดอร์ซ้อนชั้น) | `apps/web/modules/company-files/data/files.ts` |
| อัปโหลดฝั่ง client | `apps/web/modules/company-files/lib/upload.ts`, `apps/web/modules/report_task/lib/image-resize.ts` |

**ชนิดข้อมูลที่สำคัญตอนนี้:**
- `ReportPostImage = { id; url; name; mime?; size?; albumId? }` — มี `mime` อยู่แล้ว จึงพอรองรับไฟล์ที่ไม่ใช่รูปได้ในเชิงโครงสร้าง แต่ทั้ง UI และ input ปฏิบัติกับมันเป็น "รูป"
- `collectFiles(posts)` ดึงจาก `p.images` และ `r.images` (รูปในโพสต์และคอมเมนต์)
- `collectLinks(posts)` ใช้ regex ดึง URL จาก bullet ในโพสต์และ body ของคอมเมนต์ — **ephemeral** ไม่เก็บลง DB, ไม่มีชื่อ, ปักหมุดไม่ได้

**คำสั่ง typecheck (ต้องผ่านก่อน commit):**
```
cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json
```

---

## 2. งานที่ 1 — จัดระเบียบแท็บ (ทำก่อน, คุ้มสุด)

### เป้าหมาย
ยุบจาก 5 แท็บเหลือ **3 แท็บหลัก: โพสต์ · ไฟล์ · สรุป** แล้วในแท็บ "ไฟล์" มี**ตัวกรอง (segmented control)**:

```
[ ทั้งหมด ] [ รูปภาพ ] [ เอกสาร ] [ ลิงก์ ] [ อัลบั้ม ]
```

| ตัวกรอง | แสดงอะไร |
|---|---|
| ทั้งหมด | รูป + เอกสาร + ลิงก์ รวมในที่เดียว (เรียงตามเวลา) |
| รูปภาพ | รูป/วิดีโอที่โพสต์ (พฤติกรรมเดิมของแท็บ "ไฟล์") |
| เอกสาร | ไฟล์ที่ไม่ใช่รูป (pdf/word/excel) **+ เนื้อหาของ "เอกสารของห้องนี้"** (company-files) |
| ลิงก์ | ลิงก์จากโพสต์ + ลิงก์ที่ปักหมุด (ดูงานที่ 3) |
| อัลบั้ม | อัลบั้มรูปถาวร (เดิมคือแท็บ "รูปภาพ") |

### สภาพปัจจุบัน
`topicTabs` ใน `page.tsx`:
```ts
const topicTabs = [
  { id: "posts",  label: "โพสต์",  icon: MessageSquareText },
  { id: "files",  label: "ไฟล์",   icon: FileImage },     // จริง ๆ = รูปล่าสุด 7 วัน
  { id: "album",  label: "รูปภาพ", icon: FolderHeart },   // จริง ๆ = อัลบั้ม
  { id: "links",  label: "ลิงก์",  icon: Link2 },
  { id: "stats",  label: "สรุป",   icon: BarChart3 },
];
```

### สิ่งที่ต้องทำ
1. เปลี่ยน `topicTabs` เหลือ `posts` / `files` / `stats` (ตัด `album` และ `links` ออกจากแถวแท็บ) เปลี่ยนไอคอน `files` จาก `FileImage` เป็นไอคอนโฟลเดอร์/ไฟล์รวม (เช่น `Folder` หรือ `Files`)
2. ในพาเนลของแท็บ `files` (ใน `report-topic-panels.tsx`) เพิ่ม state ตัวกรอง เช่น `fileFilter: "all" | "images" | "docs" | "links" | "albums"` (ค่าเริ่มต้น `"all"`) + UI segmented control
3. ให้แต่ละตัวกรอง render เนื้อหาเดิมมาใช้ซ้ำ:
   - `images` → grid เดิมของแท็บ "ไฟล์" (โค้ดที่มี `SaveToDocumentsButton` + `AlbumPickerButton` อยู่แล้ว — คงไว้)
   - `albums` → ย้าย panel ของแท็บ `album` เดิมมาไว้ใต้ตัวกรองนี้
   - `links` → ย้าย panel ของแท็บ `links` เดิมมา (งานที่ 3 จะเสริมปักหมุด/ค้นหา)
   - `docs` → รวม (ก) ไฟล์ที่ไม่ใช่รูปจากโพสต์ (งานที่ 2) และ (ข) เนื้อหาจาก `report-topic-documents.tsx` / `listRoomFiles(topicId)`
   - `all` → รวมทุกอย่าง เรียงตาม `createdAt`
4. ย้ายกล่อง "เอกสารของห้องนี้" ออกจากหัวแท็บ ไปอยู่ในตัวกรอง "เอกสาร" (หรือคงหัวข้อไว้แต่ให้อยู่ใต้ตัวกรอง docs เท่านั้น)
5. **ช่องค้นหาเดียว** ที่หัวแท็บ "ไฟล์" ค้นได้ทุกตัวกรอง (ชื่อไฟล์ / ชื่อลิงก์ / ชื่ออัลบั้ม) — ตอนนี้มี `fileSearch` อยู่แล้วในพาเนล ให้ขยายให้ครอบ docs/links ด้วย

### เกณฑ์ผ่าน
- [ ] แถวแท็บเหลือ 3 อัน, กด "ไฟล์" เห็นตัวกรอง 5 ปุ่ม
- [ ] แต่ละตัวกรองแสดงเนื้อหาถูกต้อง, "ทั้งหมด" รวมทุกชนิด
- [ ] ปุ่มเพิ่มเข้าเอกสาร/อัลบั้มเดิมยังทำงานในตัวกรอง "รูปภาพ"
- [ ] คีย์บอร์ด (ArrowLeft/Right) ยังสลับแท็บได้ (ดูโค้ดเดิม ~บรรทัด 776 ใน page.tsx)
- [ ] `pnpm exec tsc --noEmit` ผ่าน
- [ ] responsive: แถวตัวกรองไม่ล้นจอมือถือ (wrap หรือ scroll-x)

### ทางเลือกสำรอง (ถ้าไม่เอา segmented)
คงแท็บแยกแต่**เปลี่ยนชื่อให้ตรง**: `files`→"รูปล่าสุด", `album`→"อัลบั้ม", เพิ่มแท็บ `docs`→"เอกสาร", คง `links`→"ลิงก์" (รวม 6 แท็บ) — ทำง่ายกว่าแต่แท็บเยอะและของกระจาย เลือกทางนี้เฉพาะถ้าผู้ใช้ยืนยัน

---

## 3. งานที่ 2 — รองรับไฟล์ทุกชนิด (pdf / word / excel)

### สภาพปัจจุบัน
- input แนบไฟล์ใน `openchat-feed.tsx` มี `accept="image/*,video/mp4,video/webm"` → แนบเอกสารไม่ได้
- `collectFiles` และ grid แสดงผลด้วย `ReportMediaThumb` (สมมติว่าเป็นรูป/วิดีโอ)

### สิ่งที่ต้องทำ
1. ขยาย `accept` ให้รวม `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.*`, `application/vnd.ms-excel`, `text/csv` ฯลฯ (หรือใช้ allowlist จาก config `attachment-settings` ถ้ามี)
2. เส้นทางอัปโหลด: ตรวจว่า endpoint `/api/report-task/uploads` (หรือที่ `openchat-feed` เรียก) รับไฟล์เอกสารได้ ไม่บังคับ resize เหมือนรูป — ไฟล์เอกสารต้องไม่ผ่าน `image-resize` (ดู `task-attachment-upload.ts` / `attachment-upload.ts`)
3. การแสดงผล: ถ้า `mime` ไม่ใช่ `image/*` หรือ `video/*` ให้ render เป็น **การ์ดไฟล์** (ไอคอนตามชนิด + ชื่อ + ขนาด) แทน thumbnail — ทำ component ใหม่เช่น `report-file-chip.tsx` และให้ `ReportMediaThumb` หรือ grid เลือกใช้ตาม mime
4. ปุ่ม `SaveToDocumentsButton` ใช้ได้กับไฟล์เอกสารด้วย (โค้ดปัจจุบันส่ง `mimeType: file.mime ?? "image/jpeg"` — แก้ให้ใช้ mime จริงเสมอ, อย่า fallback เป็น jpeg สำหรับเอกสาร)
5. `collectFiles` ให้แยกชนิดได้ (เพิ่ม helper `isImage(mime)` / `isDoc(mime)`) เพื่อป้อนตัวกรอง images/docs ในงานที่ 1

### เกณฑ์ผ่าน
- [ ] แนบ pdf/docx/xlsx ในโพสต์ได้ โพสต์ขึ้นการ์ดไฟล์ (ไม่ใช่รูปแตก)
- [ ] ไฟล์เอกสารโผล่ในตัวกรอง "เอกสาร" และกด "เพิ่มเข้าเอกสารของห้องนี้" ได้ mimeType ถูกต้อง
- [ ] รูป/วิดีโอเดิมยังทำงานเหมือนเดิม
- [ ] `pnpm exec tsc --noEmit` ผ่าน

### หมายเหตุ dependency
งานนี้ **ต้องมาคู่กับงานที่ 1** (ตัวกรอง "เอกสาร" ต้องมีที่อยู่) แนะนำทำ 1 ก่อนหรือพร้อมกัน

---

## 4. งานที่ 3 — ปักหมุด / ตั้งชื่อ / ค้นหาลิงก์

### สภาพปัจจุบัน
`collectLinks` เป็น ephemeral (regex จากข้อความ) — ไม่มีตารางเก็บ, ตั้งชื่อไม่ได้, ปักหมุดไม่ได้, ค้นหาได้แค่ตามข้อความในโพสต์

### สิ่งที่ต้องทำ
1. เพิ่มที่เก็บลิงก์ปักหมุดต่อห้อง — 2 ทางเลือก เลือกอันที่เข้ากับสถาปัตยกรรมที่มี:
   - **(แนะนำ)** ต่อยอด company-files: ให้ `CompanyFile` มี field `kind: "file" | "link"` และเก็บ URL ลง `storageKey` (หรือ field ใหม่ `linkUrl`) เมื่อ `kind === "link"` — จะได้ใช้โครงเดิม (โฟลเดอร์ห้อง, สิทธิ์, ค้นหา, activity log) ทันที ต้องแก้ Prisma schema + migration + `createFile`/`listRoomFiles`
   - **(เบากว่า)** ตารางใหม่ `RoomPinnedLink { id, orgId, roomId, url, title, createdBy, createdAt }` + data functions `pinLink` / `listPinnedLinks` / `unpinLink` / `renamePinnedLink`
2. UI: ในตัวกรอง "ลิงก์" (งานที่ 1) แสดง 2 กลุ่ม — "ปักหมุดไว้" (บนสุด) และ "ลิงก์จากโพสต์" (auto จาก `collectLinks`) ปุ่ม "ปักหมุด" ที่แต่ละลิงก์จากโพสต์ → บันทึกพร้อมให้ตั้งชื่อ
3. ค้นหา: ช่องค้นหาของแท็บไฟล์ต้องค้น title/url ของลิงก์ปักหมุดได้
4. สิทธิ์: ปักหมุด/ลบ ต้องเช็ค `canUserAccessReportTopic(orgId, topicId, userId)` แบบเดียวกับ `getOrCreateRoomFolder`

### เกณฑ์ผ่าน
- [ ] ปักหมุดลิงก์จากโพสต์ + ตั้งชื่อได้ (เช่น "แบบแปลน Drive")
- [ ] ลิงก์ปักหมุดอยู่ถาวร รีเฟรชแล้วยังอยู่ ค้นด้วยชื่อเจอ
- [ ] เฉพาะสมาชิกห้องเห็น/แก้ได้ (server-gated)
- [ ] มี migration ถ้าแตะ schema; `pnpm exec tsc --noEmit` ผ่าน

---

## 5. งานเสริม (ทำทีหลัง, จัดลำดับตามคุ้มค่า)

> รายละเอียดพอสังเขป — ทำเมื่องาน 1–3 เสร็จและผู้ใช้ยืนยัน

1. **กันเพิ่มซ้ำ + สถานะ "เพิ่มแล้ว" ถาวร** — ตอนนี้ ✓ ของ `SaveToDocumentsButton` เก็บใน state ชั่วคราว รีเฟรชแล้วกดซ้ำได้ → เอกสารซ้ำ ควรเช็คจาก `listRoomFiles` ว่า storageKey นี้อยู่แล้วหรือยัง แล้วปิดปุ่ม/ขึ้น "เพิ่มแล้ว"
2. **ตั้งชื่อไฟล์อัตโนมัติตอนบันทึก** — แทน `image.png` ที่ซ้ำกันทั้งโฟลเดอร์ ให้ประกอบชื่อจาก หัวข้อโพสต์ + ผู้โพสต์ + วันที่ (เช่น `หน้างานเสาเข็ม-020969.jpg`) ตอน `addFileToRoomFolder`
3. **บันทึกอัตโนมัติต่อห้อง (auto-save)** — ตัวเลือกในตั้งค่าห้อง (`room-settings-sheet.tsx`) ว่า "ไฟล์ที่โพสต์ให้เข้าเอกสารอัตโนมัติ" สำหรับห้องอย่าง daily-report / booking-checkin
4. **เลือกหลายไฟล์แล้วเพิ่มทีเดียว** — โหมด multi-select ในตัวกรองไฟล์ + ปุ่ม bulk
5. **โฟลเดอร์ย่อย / จัดหมวด** — company-files รองรับ `createFolder(parentId)` อยู่แล้ว ให้เลือกโฟลเดอร์ปลายทาง หรือ auto แยกตามเดือน/ชนิด
6. **ชื่อซ้ำ → เพิ่มเป็นเวอร์ชันใหม่** — ใช้ `addFileVersion` แทนการสร้างไฟล์ซ้ำ
7. **ลิงก์กลับไปโพสต์ต้นทาง** — เก็บ `postId` ไว้กับ CompanyFile (เช่นใน field detail/activity) แล้วให้กดเด้งกลับไปโพสต์เดิม
8. **แชร์ไฟล์ออก** — เปิดใช้ `createShareLink` (มีรหัสผ่าน/วันหมดอายุอยู่แล้ว) จากหน้าห้อง

---

## 6. ข้อควรระวัง / Non-goals

- **อย่ารื้อ** commit `841d517` (`save-to-documents-button.tsx` + การ threading `size` ใน `uploadCompressedImage`) — ทำงานถูกแล้ว ต่อยอดเท่านั้น
- **สิทธิ์การเห็น**: ทุกทางเข้าใหม่ต้องเช็ค `canUserAccessReportTopic` ที่ server เหมือนของเดิม อย่าเช็คแค่ใน UI
- **ไม่อัปโหลดซ้ำ**: การเพิ่มไฟล์ที่โพสต์แล้วเข้าเอกสาร ต้องชี้ storage url เดิม (pattern เดิมใน `SaveToDocumentsButton`) ไม่เขียน bytes ใหม่ ไม่กิน quota
- **Lifecycle ไฟล์ร่วม**: เพราะเอกสารชี้ storageKey เดียวกับไฟล์แนบในแชท ให้ตรวจเส้นทางลบโพสต์/ไฟล์แนบว่าจะไม่ทำให้เอกสารในห้องกลายเป็นลิงก์เสีย (ยังไม่พบจุดลบ storage object จริงในโมดูล report_task — ควรยืนยันก่อนทำ auto-save)
- ทุกงานที่แตะ Prisma schema ต้องมี migration และรัน typecheck ให้ผ่าน

---

## 7. ลำดับที่แนะนำ

1. **งานที่ 1 (จัดแท็บ + ตัวกรอง)** — โครงหลัก งานอื่นแขวนอยู่บนนี้
2. **งานที่ 2 (ไฟล์ทุกชนิด)** — ทำคู่/ต่อจาก 1 เพราะตัวกรอง "เอกสาร" ต้องมีของ
3. **งานที่ 3 (ปักหมุดลิงก์)** — เติมตัวกรอง "ลิงก์" ให้ครบ
4. **งานเสริม** — ตามที่ผู้ใช้เลือก (แนะนำเริ่มข้อ 1 กันซ้ำ + ข้อ 2 ตั้งชื่ออัตโนมัติ)

> ทำทีละงาน, typecheck ผ่านทุกครั้งก่อน commit, แต่ละ commit สื่อความชัดว่าแตะอะไร
