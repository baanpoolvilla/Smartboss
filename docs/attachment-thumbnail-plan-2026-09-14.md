# แผน: thumbnail เนื้อหาจริงสำหรับไฟล์แนบ (PDF/Word/Excel/PowerPoint)

สืบเนื่องจากบั๊ก "ไฟล์แนบแสดงไม่สวย" ใน report-feed — ไฟล์เอกสารตอนนี้แสดงเป็นการ์ด
ไอคอน+ชื่อไฟล์ (แก้ไปแล้ว, deploy ยังไม่แล้ว) แต่ผู้ใช้อยากได้ thumbnail
"เนื้อหาจริง" แบบที่ Microsoft Teams ทำ (หน้าแรกของเอกสารเป็นภาพจริง) ทุกชนิดไฟล์
ที่ดูได้ ไม่ใช่แค่ไอคอน

**สถานะ**: แผนรออนุมัติ ยังไม่มีโค้ด

## ทำไมถึงเป็นงานคนละขนาดกับ bug fix เดิม

`<img src="file.pdf">` ที่เห็นสวยบนมือถือ (screenshot ที่ผู้ใช้ส่งมา) ไม่ใช่ฟีเจอร์ —
เป็น quirk ของ WebKit บน iOS ที่ decode หน้าแรกของ PDF เป็นภาพให้เฉย ๆ Chrome/
Firefox/Edge/Android WebView ไม่ทำแบบนี้ ดังนั้นจะให้ได้ผลแบบเดียวกันทุกแพลตฟอร์ม
ต้อง **render ภาพจริงที่ server แล้วเก็บเป็นไฟล์ PNG** ไม่ใช่พึ่งเบราว์เซอร์เดา

## Pipeline

```
ไฟล์อัปโหลด (upload route เดิม, หลังผ่านการตรวจ mime/ขนาดแล้ว)
  │
  ├─ image/*, video/*        → ไม่ต้องทำอะไร (เหมือนเดิม)
  │
  ├─ application/pdf         → pdftoppm -png -f 1 -l 1 -scale-to 720 in.pdf out
  │
  └─ doc/docx/xls/xlsx/       → soffice --headless --convert-to pdf → out.pdf
     ppt/pptx                     │
                                   └─ pdftoppm หน้า 1 ของ out.pdf (path เดียวกับ PDF)
  │
  └─ txt/csv/zip             → ไม่มีทาง "ดู" เป็นภาพได้จริง — คงเป็นการ์ดไอคอน
```

ทั้งสอง binary (`soffice`, `pdftoppm`) เป็นของมาตรฐานที่แอปจัดการไฟล์ทั่วไปใช้กัน
(LibreOffice headless + poppler-utils) ไม่ใช่ของเฉพาะกิจ

## สิ่งที่ต้องมีบนเซิร์ฟเวอร์ (ผู้ใช้ทำเอง — ไม่มีสิทธิ์เข้า prod)

```bash
sudo apt-get update
sudo apt-get install -y libreoffice poppler-utils
which soffice pdftoppm   # ยืนยันว่าเจอทั้งคู่ก่อน deploy โค้ดนี้
```

โค้ดออกแบบให้ **deploy ก่อนติดตั้งแพ็กเกจได้โดยไม่พัง** — แปลงไม่สำเร็จ = fallback
เป็นการ์ดไอคอนเงียบ ๆ (ดูหัวข้อ fail-safe) แต่แนะนำติดตั้งก่อน deploy เพื่อให้ไฟล์
ชุดแรกได้ thumbnail เลยไม่ต้องอัปโหลดซ้ำ

## รายละเอียด engineering ที่ต้อง bake เข้าไปตั้งแต่แรก

### 1. Timeout ต่อขั้นตอน (ฆ่า process ถ้าเกิน ไม่ปล่อยค้าง)
- `soffice --convert-to pdf`: **20 วินาที** — งานปกติ (เอกสาร/สไลด์ไม่กี่สิบหน้า) ใช้
  จริง 2-5 วิ, 20 วิ กันไฟล์ใหญ่/ซับซ้อนผิดปกติไม่ให้ค้างเป็นนาที
- `pdftoppm` (ทั้งกรณี PDF ตรงและ PDF ที่แปลงมา): **10 วินาที** — ปกติ &lt;1 วิ
- รวม thumbnail step ทั้งหมดไม่เกิน **~30 วินาที** ต่อไฟล์ — ถ้าเกิน = ยกเลิก
  thumbnail เท่านั้น **ไม่ทำให้การอัปโหลดไฟล์จริงล้มเหลว** (คนละ path กัน)

### 2. Concurrency limit (กัน CPU/RAM พุ่งพร้อมกันจนกระทบ service อื่นบนเครื่องเดียวกัน)
- **ปรับจากร่างแรก** หลังพบว่าเครื่อง prod จริงคือ `e2-medium` (2 vCPU/4GB —
  ดู docs/deploy.md ที่บอกว่า `next build` เองยังต้องระวัง OOM) ตึงกว่าที่คิด
  ไว้ตอนร่างแผน จึงรัดกุมกว่าเดิม:
  - **แปลงได้ทีละ 1 งานเท่านั้นทั้งเซิร์ฟเวอร์** (ทุก org รวมกัน)
  - งานที่สองที่มาซ้อนระหว่างงานแรกกำลังรัน **ข้าม thumbnail ทันที ไม่ต่อคิว
    เลย** (ไม่ใช่รอ 5 วิ แล้วค่อยข้ามแบบร่างแรก) — คำขออัปโหลดจึงไม่มีทาง
    ช้าขึ้นจากกลไกนี้แม้แต่วินาทีเดียว แลกกับ: ตอนมีคนอัปโหลด office/pdf
    พร้อมกันหลายคนจริง ๆ บางไฟล์ในช่วงนั้นจะไม่มี thumbnail (fallback การ์ด
    ไอคอนเดิมรับไว้ให้อยู่แล้ว)
  - เช็ก `os.freemem()` ก่อนเริ่มทุกครั้งด้วย (ข้อ freemem ด้านล่าง) — สอง
    เงื่อนไขนี้ทำงานร่วมกัน ไม่ใช่แทนกัน

### 3. Process isolation
- แต่ละ conversion ใช้ temp dir แยกของตัวเอง (`os.tmpdir()/report-thumb-<uuid>/`)
- `soffice` ต้องสั่งด้วย `-env:UserInstallation=file:///<tmpdir>/lo-profile` เสมอ
  — ถ้าไม่ทำ conversion หลายอันพร้อมกันจะแย่ง lock profile เดียวกันจน error
  (ปัญหาที่รู้กันดีของ LibreOffice headless แบบ concurrent)
- ลบ temp dir ทิ้งใน `finally` เสมอ ไม่ว่าสำเร็จหรือพัง — กันดิสก์เต็มจากไฟล์ค้าง

### 4. ความปลอดภัย (เอกสารมาจากผู้ใช้ — ต้องถือว่าไม่น่าเชื่อถือ)
- profile ที่สร้างใหม่ทุกครั้ง (ข้อ 3) ไม่มีการตั้ง "always enable macro" ไว้ ⇒
  headless convert จะไม่รันมาโครที่ฝังมาในไฟล์ — เป็นพฤติกรรมมาตรฐานของ LibreOffice
  headless อยู่แล้ว แต่จะยืนยันด้วยการเทสต์ไฟล์ที่มีมาโครจริงก่อน deploy
- **ความเสี่ยงที่เหลืออยู่ที่ยอมรับไว้อย่างเปิดเผย**: LibreOffice/poppler เป็นโค้ด
  C++ ขนาดใหญ่ที่ parse ไฟล์ binary ซับซ้อน เคยมีช่องโหว่ระดับ parser (ไม่ใช่แค่
  มาโคร) มาก่อน — ระบบนี้ไม่มี container/sandbox แยกให้ตอนนี้ (ไม่ใช้ Docker) จึง
  รันด้วยสิทธิ์ user `smartboss` เดิม (ไม่ใช่ root อยู่แล้ว) เป็นชั้นป้องกันเดียว
  ถ้าอนาคตอยากยกระดับ (เช่น firejail/systemd sandboxing) ทำเพิ่มได้ทีหลังโดยไม่
  กระทบ code path นี้
- ไม่ต่อ network ระหว่าง conversion (soffice headless ปกติไม่เรียกเน็ตอยู่แล้ว
  ไม่ต้องเซ็ตอะไรเพิ่ม)

### 5. Fail-safe / fallback
- แปลงพัง (binary ไม่มี / timeout / exit code ผิด / ไฟล์เสีย) → log
  `console.error` แล้วคืน `thumbUrl: null` — **การอัปโหลดไฟล์จริงต้องไม่ล้มเหลว
  ตามไปด้วยเด็ดขาด** สองอย่างนี้ทำใน try/catch คนละชั้นกัน
- Client เจอ `thumbUrl` ว่าง = fallback ไปการ์ดไอคอนแบบที่ deploy ไปแล้วรอบก่อน
  (ของเดิมไม่หายไปไหน เป็นชั้น fallback ที่ยังใช้งานได้เสมอ)

## การเปลี่ยนแปลงฝั่ง data/response

- `POST /api/report-task/uploads` response: เพิ่ม `thumbUrl?: string`
- Thumbnail เก็บผ่าน `putFile` เดิม (S3/disk อัตโนมัติตาม env เหมือนไฟล์จริง) คีย์
  ต่อท้ายด้วย `-thumb.png` อยู่โฟลเดอร์เดียวกับไฟล์จริง (`<orgId>/report-task/...`)
- `ReportPostImage` (type ที่ client เก็บต่อ attachment) เพิ่มฟิลด์ `thumbUrl?`
  — เก็บอยู่ใน JSON blob ของโพสต์เหมือนฟิลด์อื่น (`url`/`mime`/`name`/`size`)
  **ไม่ต้อง migrate database** เพราะเป็น JSON column ไม่ใช่ schema column

## การเปลี่ยนแปลงฝั่งแสดงผล

- **ในโพสต์/กริด** (`PostImageThumb`/`ReportMediaThumb`): มี `thumbUrl` → แสดงเป็น
  ภาพจริงแบบเดียวกับรูปถ่าย (object-cover เข้ากับกริด) พร้อม badge เล็กมุมภาพบอก
  ชนิดไฟล์ (PDF/DOCX/XLSX ฯลฯ) กันสับสนว่าเป็นรูปถ่ายจริง — ไม่มี `thumbUrl` →
  การ์ดไอคอนเดิม
- **ตอนกดเข้าไปดู (lightbox)**:
  - PDF: ยังฝังดูแบบ interactive จริงด้วย `<iframe>` ต่อไป (ทำไปแล้วรอบก่อน — ดี
    กว่าภาพนิ่งเพราะเลื่อนดูได้ทุกหน้า) ปุ่มดาวน์โหลดแยกเหมือนเดิม
  - Word/Excel/PPT: ไม่มีตัวเรนเดอร์ในเบราว์เซอร์ให้ฝังจริง ๆ ได้ ⇒ โชว์
    `thumbUrl` ขนาดใหญ่ (หน้าแรก นิ่ง ไม่ใช่ live document) + ปุ่มดาวน์โหลด —
    ดีขึ้นกว่าการ์ดไอคอนเดิมชัดเจนแต่ยังไม่ใช่ interactive แบบ PDF
  - ไม่มี `thumbUrl` (แปลงไม่สำเร็จ/zip/txt) → การ์ดไอคอน+ดาวน์โหลดเดิม

## เทสต์

- Unit test path-selection logic (เลือก pipeline ตาม mime) — ไม่ต้องมี binary จริง
- Integration test เรียก `soffice`/`pdftoppm` จริง — **skip อัตโนมัติถ้าเครื่องไม่มี
  binary** (เครื่อง dev นี้เป็น Windows ไม่มี LibreOffice) ต่างจาก tenant-isolation
  tests ที่ต้องมี Postgres จริงเสมอ อันนี้ผ่อนเป็น best-effort เพราะเป้าหมายคือ
  ป้องกันการเปลี่ยน pipeline logic โดยไม่ตั้งใจ ไม่ใช่ยืนยันความถูกต้องทุก build
- ถ้าอยากได้ coverage เต็มใน CI ต้องเพิ่ม `apt-get install libreoffice
  poppler-utils` เข้า `.github/workflows/ci.yml` ด้วย (เพิ่มเวลา CI รันนาทีนึง
  ขึ้นไปจากขนาดแพ็กเกจ) — เป็นทางเลือก ไม่ทำก็ได้ถ้าไม่อยากให้ CI ช้าลง

## ขั้นตอน rollout

1. คุณรัน `sudo apt-get install -y libreoffice poppler-utils` บน server จริง
2. ผมเขียนโค้ด + เทสต์ (local ไม่มี binary ก็ typecheck/unit test ผ่านได้ตามปกติ)
3. ส่ง diff ให้ดูตามเดิม
4. Deploy ผ่าน `release.sh`
5. ทดสอบมือ: อัปโหลด .pdf, .docx, .xlsx, .pptx จริงในห้องทดสอบ เช็คว่า
   thumbnail ขึ้นและกดดาวน์โหลดได้ครบ ก่อนถือว่าจบงาน
