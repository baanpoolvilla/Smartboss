# สเปค: LINE Mini App (LIFF) + เข้างานแบบ check-in location

สำรวจโค้ดจริง 2026-09-09 · ต่อจาก [workforce_integration.md](workforce_integration.md) และ
[notifications-unified-spec.md](notifications-unified-spec.md)

**ความคืบหน้า**

- ✅ ข้อ 4.1 `/hr/sites` + `GET`/`PATCH /sites/:siteId` — 2026-09-09
  (เทสต์ 8 ตัวใน `apps/workforce-api/src/organization.test.ts`)
- ✅ ข้อ 3.1/3.2 สะพานตัวตน LINE — `lib/line.ts`, `app/api/auth/line/` (+`/link`)
- ✅ ข้อ 4.2 หน้า Mini App ที่ `app/m/` — จอ "วันนี้" + ปุ่มลงเวลา + `app/api/m/*`
- ✅ `lineUserId` → `@unique` + migration `20260909130000_line_user_id_unique`
  (**ยังไม่ได้ลงบน production** — ต้องรัน query ตรวจค่าซ้ำในข้อ 9.2 ก่อน)
- ✅ งาน console ฝั่ง LINE: provider `Smartboss` + OA + Mini App channel
  (Developing `2011520804`, Review `2011520805`, Published `2011520806`)
- ✅ ข้อ 4.3 `/hr/checkin-policy` — สร้าง/ดูนโยบาย + จัดคนเข้ากลุ่ม (มีปุ่มจัด
  ทุกคนที่ยังไม่มีกลุ่มรวดเดียว) · เพิ่ม `GET /attendance-policy-groups` และ
  `GET /attendance-policy-group-members` ฝั่ง workforce ซึ่งเดิมมีแต่ POST
- ⬜ เหลือ: อนุมัติเครื่องมือถือ · คิวตรวจ `PENDING_REVIEW` · `/api/line/webhook`
  · หน้าลา/แจ้งเตือน/ของฉัน ใน Mini App — ดูลำดับในข้อ 9.3

---

## 0. ข้อตัดสินใจที่ล็อกแล้ว (อย่ารื้อโดยไม่คุยกับเจ้าของงาน)

### 0.1 ใช้ **OA กลางของ Smartboss ตัวเดียว** ไม่ใช่ OA รายบริษัท

เจ้าของงานตัดสิน 2026-09-09 และข้อนี้เป็นตัวกำหนดสถาปัตยกรรมทั้งหมดที่เหลือ

เหตุผลทางเทคนิคที่ทำให้ทางนี้ทำงานได้: LINE ระบุว่า *"Different user IDs are generated
based on the provider of the channel. As long as channels have the same provider,
regardless of whether the channel is for LINE Login or Messaging API, the same user ID
is used"* ⇒ ถ้า **LINE Login channel (ที่ LIFF ใช้) กับ Messaging API channel (OA ที่ส่ง
push) อยู่ใน provider เดียวกัน** ค่า `sub` ที่ได้จากการ login จะเอาไปยิง push ได้ตรง ๆ

กลับกัน ถ้าเคยคิดจะให้แต่ละบริษัทใช้ OA ของตัวเอง (ซึ่งเป็นสิ่งที่โค้ดวันนี้ทำอยู่ ดูข้อ 5)
มันจะ **พังเงียบ**: `sub` จาก LIFF ของ Smartboss ไม่ใช่ user ID ในสายตา OA ของบริษัท
ลูกค้า → push ไม่ถึงใครเลยโดยไม่มี error ที่ชี้สาเหตุ

สิ่งที่ต้องยอมรับแลกมา:

- **โควตาข้อความรวมทุกบริษัท** Smartboss เป็นคนจ่าย ⇒ ต้องคิดบัญชีรายบริษัทไว้ตั้งแต่วันแรก
  (`LineNotificationLog` มี `orgId` อยู่แล้ว — ใช้ตัวนี้ออกรายงาน ห้ามลบคอลัมน์นี้)
- พนักงานทุกบริษัทเห็นชื่อ/รูป OA ว่า "Smartboss" ไม่ใช่ชื่อบริษัทตัวเอง — ยอมรับได้เพราะ
  ผู้รับคือ *พนักงาน* ไม่ใช่ลูกค้าของบริษัทนั้น
- **ข้อยกเว้นที่ยังต้องใช้หลาย token:** แชท B2B กับพาร์ทเนอร์ (ข้อ 6) ยิงเข้ากลุ่ม LINE ของ
  พาร์ทเนอร์ด้วย OA ของพาร์ทเนอร์เอง ⇒ เรื่องนั้นยังต้องเก็บ token หลายตัว
  "OA กลาง" ตัดสินเฉพาะ **การแจ้งเตือนพนักงาน** อย่าเอาสองเรื่องนี้มาปนกัน

### 0.1.1 ⚠ โครงสร้างค่าใช้จ่าย — ข้อนี้กระทบกำไรโดยตรง ออกแบบผิดแล้วแก้ทีหลังยาก

กฎการนับของ LINE (ยืนยันจาก developers.line.biz/en/docs/messaging-api/pricing):

| ข้อเท็จจริง | ผลที่ตามมากับเรา |
|---|---|
| นับ **ตามจำนวนคนที่ส่งถึง** ไม่ใช่จำนวนครั้งที่เรียก API — ยิงทีเดียวถึง 5 คน = 5 ข้อความ | ค่าใช้จ่ายโตตาม *จำนวนพนักงานทุกบริษัทรวมกัน* |
| ที่นับ: push, multicast, broadcast, narrowcast | การแจ้งเตือนที่เราเริ่มเองทุกแบบเสียเงิน |
| **reply message ไม่นับ** (ตอบกลับด้วย `replyToken` จาก webhook) | ของฟรีที่ต้องใช้ให้คุ้ม — ดูกลยุทธ์ข้างล่าง |
| โควตาหมด = **API ตอบ error แล้วข้อความไม่ถูกส่ง** | **ใช้ OA ตัวเดียว ⇒ โควตาหมดกลางเดือน แจ้งเตือนของลูกค้า *ทุกราย* ดับพร้อมกัน** |

**ขอบเขตการแจ้งเตือนที่เจ้าของงานกำหนด (2026-09-09) ช่วยเรื่องนี้มาก:** ส่งเฉพาะ
*เวลามีคนกล่าวถึง (mention) หรือเรื่องที่เกี่ยวกับตัวผู้ใช้เองโดยตรง* เท่านั้น
ไม่ใช่สรุปรายวันให้ทุกคน ⇒ ปริมาณลดจากหลักหมื่นเหลือหลักพันต่อเดือน และตรงกับกฎข้อ 1
ข้างล่างอยู่แล้ว · **แต่เพดานยังมีอยู่และยังเป็นของกลาง** ตัวนับรายบริษัท (ข้อ 3) จึงยัง
ต้องทำ ไม่ใช่ตัดออกเพราะปริมาณน้อยลง

คำนวณคร่าว ๆ ถ้าปล่อยให้แจ้งเตือนกว้างกว่านี้: 2 ข้อความ/คน/วัน × 22 วันทำงาน = 44/คน/เดือน
⇒ 10 บริษัท × 50 คน = **22,000 ข้อความ/เดือน** · 50 บริษัท × 50 คน = **110,000/เดือน**
ขณะที่แพ็กเกจสูงสุดให้มาในระดับหลักหมื่น ส่วนเกินคิดรายข้อความ
(ตัวเลขไทยต้องเช็คหน้า LINE for Business ของไทยก่อนตั้งราคาขาย — LINE ปรับราคาเป็นระยะ)

**รายได้ subscription คงที่ต่อบริษัท แต่ต้นทุนข้อความผันแปรตามจำนวนพนักงาน**
⇒ ถ้าไม่คุมตั้งแต่ต้น บริษัทที่มีพนักงาน 300 คนจะกินกำไรจากลูกค้ารายอื่นทั้งหมด

**4 อย่างที่ต้องทำตั้งแต่วันแรก (ไม่ใช่ทำทีหลัง):**

1. **ออกแบบให้พนักงาน "เริ่มก่อน" เพื่อให้ตอบด้วย reply message ที่ฟรี** — Rich Menu
   ปุ่ม "ลงเวลา" → postback → webhook → ตอบผลด้วย `replyToken` = **฿0**
   สิ่งที่ควรเป็น reply หรือให้ไปดูใน LIFF เอง (ฟรีทั้งคู่): ผลการลงเวลา, เกรดรายวัน,
   สลิป, สถานะใบเบิก · สิ่งที่จำเป็นต้อง push จริง ๆ: เรื่องที่ *ต้องรู้เดี๋ยวนี้* และ
   พนักงานไม่ได้เปิดแอปอยู่ (ใบเบิกได้รับอนุมัติ, ใบงานด่วนเข้า, ลืมลงเวลาออก)
   ⇒ เปลี่ยนต้นทุนจาก "โตตามจำนวนพนักงาน" เป็น "เกือบคงที่"
2. **รวมเป็น digest วันละฉบับ** แทนการยิงแยกทุกเหตุการณ์ · เกรด A-F รายวันคือตัวอย่าง
   ที่ไม่ควร push แยกเด็ดขาด (1 ข้อความ/คน/วัน = ตัวกินโควตาอันดับหนึ่ง)
3. **โควตาต่อบริษัท บังคับในโค้ด** นับจาก `LineNotificationLog` (มี `orgId` อยู่แล้ว)
   เกินแล้วหยุดส่งเฉพาะบริษัทนั้น **ห้ามให้บริษัทเดียวลากโควตากลางจนคนอื่นดับ**
   ⇒ เรื่องนี้เข้าทาง SaaS พอดี: "แจ้งเตือน LINE x,xxx ข้อความ/เดือน" กลายเป็นฟีเจอร์
   ของแพ็กเกจและเป็นช่องขายต่อยอด
4. **in-app notification เป็นช่องทางหลัก LINE push เป็นส่วนเสริม** — `core.notifications`
   + กระดิ่งรวมศูนย์มีอยู่แล้ว (ดู [notifications-unified-spec.md](notifications-unified-spec.md))
   ของที่ไม่ด่วนให้ไปโผล่ที่กระดิ่ง ไม่ต้องเสียเงินยิง LINE

### 0.2 LIFF อยู่ในรีโปเดิม ไม่แยกโปรเจกต์ "SmartBoss-App"

ทำเป็น route group ใหม่ `apps/web/app/(liff)/` เพราะ auth / Prisma / data layer / notify
อยู่ที่นี่หมด ถ้าแยกโปรเจกต์ตอนนี้ต้องเขียน REST API ทั้งชุดก่อน ซึ่งขัดกับข้อสรุปเดิมว่า
*"อย่าเพิ่งเขียน API รอไว้ — หน้าตา API ต้องตามหน้าจอแอป เขียนก่อนแล้วต้องรื้อ"*

แยกออกไปทีหลังได้เมื่อหน้าจอนิ่ง (`apps/workforce-api` คือตัวอย่างที่แยกสำเร็จแล้วในรีโปนี้)

### 0.3 เป้าหมายคือ **LINE Mini App** (เจ้าของงานยืนยัน 2026-09-09)

ไม่ใช่ LIFF app ธรรมดา · ข้อจำกัดของ Mini App ที่ต้องออกแบบตามตั้งแต่ต้น ไม่ใช่มารู้ทีหลัง:

| ข้อจำกัด | ผลกับการออกแบบ |
|---|---|
| **ขนาดจอได้แค่ `Full`** ปรับไม่ได้ | ออกแบบเป็นเต็มจอตั้งแต่แรก ไม่ต้องคิดเรื่อง tall/compact |
| **ซ่อน action button ไม่ได้** (ไม่มี Module mode) | มีแถบของ LINE อยู่ด้านบนเสมอ — เผื่อที่ไว้ อย่าวาง UI สำคัญชิดขอบบน |
| **1 Mini App channel แตกเป็น 3 สภาพแวดล้อมในตัว**: Developing / Review / Published แต่ละตัวมี **LIFF ID และ endpoint URL ของตัวเอง** | ⇒ **สร้างแชนเนลเดียวพอ** ไม่ต้องทำ channel แยกสำหรับ dev (ดูข้อ 0.6) |
| ใส่ basic auth ป้องกัน endpoint ของ Developing / Review ได้ ระหว่างที่ยังไม่เผยแพร่ | ทดสอบบน URL จริงได้โดยคนนอกเข้าไม่ถึง · ใช้ไม่ได้เมื่อสถานะเป็น "Reflected" แล้ว |
| **Unverified** ใช้ได้ทันทีหลังสร้าง แต่ฟีเจอร์จำกัด · **Verified** ต้องผ่าน review | เริ่มพัฒนาบน unverified ได้เลย ไม่ต้องรอ review · ของที่ได้เพิ่มตอน verified: ปุ่มลัดบนหน้าโฮม, custom path, ลดขั้นตอนขอ consent |

**แผน: พัฒนาบน unverified channel ให้เสร็จก่อน แล้วค่อยยื่น review ขอ verified**
ไม่ต้องรอ review ก่อนเริ่ม และไม่ต้องเขียนโค้ดเป็น LIFF แล้วมาแปลงทีหลัง

### 0.3.1 ⚠ Service message ใช้แจ้งเตือน "มีคนกล่าวถึงคุณ" ไม่ได้

Mini App มีช่องทางแจ้งเตือนของตัวเองชื่อ service message ซึ่งไปโผล่ในห้องแชทรวม
("LINE MINI App Notice") — ดูน่าใช้ แต่ **นโยบายเนื้อหาบังคับว่าต้องเป็น "การยืนยันหรือ
การตอบสนองต่อการกระทำของผู้ใช้เอง" เท่านั้น** ห้ามใช้กับโฆษณาและการแจ้งเหตุการณ์ทั่วไป
ข้อจำกัดอื่น: template ต้องผ่าน review, ไม่เกิน 20 template/channel, 1 การกระทำส่งได้
ไม่เกิน 5 ข้อความ, ความยาวจำกัดราว 50–150 ตัวอักษร

⇒ แบ่งการแจ้งเตือนเป็น 2 ชนิดตามนี้ (สำคัญ — ผิดข้อนี้คือถูกตีตกตอน review):

| แจ้งเตือน | ช่องทาง | เหตุผล |
|---|---|---|
| ผลการลงเวลาของตัวเอง · ผลอนุมัติใบเบิกที่ตัวเองยื่น · ผลประเมินของตัวเอง | **service message** ได้ | เป็นการตอบสนองต่อการกระทำของผู้ใช้เอง |
| **"มีคนกล่าวถึงคุณ"** · มีคนมอบหมายงานให้ · ใบงานด่วนเข้า | **OA push message** | คนอื่นเป็นคนกระทำ ไม่ใช่ตัวผู้ใช้ ⇒ ไม่เข้าเกณฑ์ service message |

ข้อที่สองจึง **นับโควตาและต้องเป็นเพื่อนกับ OA** ตามข้อ 0.1.1 — หนีไม่ได้

### 0.4 ⚠ สิ่งที่ LIFF ทำไม่ได้ — กระทบ "ความน่าเชื่อถือของการลงเวลา" โดยตรง

นโยบายใน `checkin.ts` มีปุ่มกันโกงหลายตัวที่ **ออกแบบมาสำหรับแอป native** และจะใช้
ไม่ได้จริงบน webview ของ LINE · ต้องรู้ว่าเปิดไว้แล้วก็ไม่มีผล ไม่ใช่เข้าใจผิดว่ากันได้แล้ว

| ปุ่มในนโยบาย | บน LIFF ได้จริงไหม |
|---|---|
| `attestation_status` (VERIFIED/FAILED) | **ไม่ได้** — Play Integrity / DeviceCheck ต้องเป็น native ⇒ ค่าจะเป็น `UNAVAILABLE` ตลอด |
| `mock_location_suspected` | **ตรวจไม่ได้** — แอป fake GPS ป้อนค่าเข้า `navigator.geolocation` แล้วหน้าเว็บแยกไม่ออก |
| `require_enrolled_device` (1 เครื่อง/คน) | **อ่อนลง** — `device_fingerprint` บน webview คือค่าใน localStorage ลบ/ก๊อปได้ |
| `require_live_capture` (ถ่ายสด ไม่ใช่เลือกจากคลัง) | **ไม่รับประกัน** — บางเครื่องยังเลือกจากคลังได้แม้ใส่ `capture` |
| พิกัด + รัศมี + accuracy + เวลาจากเซิร์ฟเวอร์ | **ได้ครบ** — ยังกันการโกงแบบง่าย ๆ ได้ |
| ตัวตนผู้ใช้ | **ดีกว่า** web login ปกติ — ผูกกับบัญชี LINE ที่ verify แล้ว ยืมกันยากกว่ารหัสผ่าน |

สรุปอย่างเป็นธรรม: **LIFF ดีกว่าเว็บล็อกอินเรื่องตัวตน แต่แย่กว่าแอป native เรื่อง
ความสมบูรณ์ของเครื่อง** ⇒ คนที่ตั้งใจโกง (ให้เพื่อนกดแทน + fake GPS บนเครื่อง root)
ทำได้ง่ายกว่าบนแอป native อย่างมีนัยสำคัญ

**ทางออกที่ไม่ต้องทำแอป native:** ใช้ `allowed_methods` ใน policy group ที่มีอยู่แล้ว
แบ่งตามลักษณะงาน — **เครื่องสแกนลายนิ้วมือ (ESP32 ที่ deploy แล้ว) สำหรับไซต์ประจำ**
+ **MOBILE_PHOTO ผ่าน LIFF สำหรับพนักงานภาคสนาม/นอกสถานที่** แล้วตั้ง
`risk_action = REVIEW` ให้ฝั่ง LIFF เพื่อให้ของที่น่าสงสัยเข้าคิวให้คนตรวจ ไม่ใช่ปฏิเสธ
หรือปล่อยผ่านเงียบ ๆ

### 0.5 อย่าผูกหน้าจอไว้กับ LIFF แบบถอดไม่ได้ (ประกันราคาถูก)

OA กลางตัวเดียว = **จุดล้มเหลวจุดเดียวของลูกค้าทุกราย** (LINE ล่ม / OA ถูกระงับ /
โควตาหมด ⇒ พนักงานทุกบริษัทเข้าไม่ได้พร้อมกัน)

หน้าใน `app/(liff)/` เป็น route ธรรมดาบนโดเมนเราเองอยู่แล้ว ⇒ เขียนให้
**ทำงานได้ในเบราว์เซอร์มือถือปกติด้วย**: ถ้า `liff.init()` ล้มหรือไม่ได้เปิดจากใน LINE
ให้ตกไปใช้ login อีเมล/รหัสผ่านตามปกติ ไม่ใช่ขึ้นจอขาว · ต้นทุนตอนออกแบบไว้แต่แรก
แทบเป็นศูนย์ แต่ถ้าผูกแน่นแล้วมาแก้ทีหลังต้องรื้อทุกหน้า

### 0.6 ที่ทดสอบ: **Cloudflare Tunnel → `dev.smartboss.in.th`** ไม่ใช่ `test.smartboss.in.th` บน VM เดิม

Mini App channel เดียวแตกเป็น 3 สภาพแวดล้อมให้เองอยู่แล้ว แต่ละตัวตั้ง endpoint URL
แยกกันได้ ⇒ **ไม่ต้องสร้างแชนเนลที่สอง** แค่ชี้ปลายทางให้ถูก:

| สภาพแวดล้อม | endpoint URL |
|---|---|
| Developing | `https://dev.smartboss.in.th` (tunnel เข้าเครื่อง dev) |
| Review | ตั้งตอนจะยื่น review — ชี้ production ได้ |
| Published | `https://app.easyboss.app` |

**ทำไมไม่ทำ `test.smartboss.in.th` บน VM เดิม:** เครื่องเป็น `e2-medium` = 2 vCPU /
**4 GB** + swap 2 GB และ `deploy/check-vm.sh` เองเตือนว่าต่ำกว่า ~3.7 GB ตัว
`next build` มักโดน OOM kill · ตอนนี้เครื่องนั้นแบก Postgres + Redis + MinIO + Caddy +
โปรเซสแอป 4 ตัว และ `release.sh` **build บนเครื่องเดียวกันกับที่ให้บริการอยู่**
⇒ ยัดสแต็กที่สองเข้าไปคือการเอา production ไปเสี่ยง OOM เพื่อประหยัดค่าเครื่องที่สอง
ไม่คุ้มเลย

**ทางที่เลือก:** รัน dev ตามปกติบนเครื่องตัวเอง (ใน WSL — ดูข้อจำกัดใน
[deploy.md](deploy.md)) แล้วเปิด Cloudflare Tunnel ชื่อคงที่มาที่ `localhost:3000`
ผูกกับ `dev.smartboss.in.th` (โดเมนนี้เป็นของเราอยู่แล้ว)

- ได้ HTTPS จริงที่ LIFF ต้องการ · URL นิ่ง ไม่ต้องไปแก้ endpoint ใน console ทุกครั้ง
- **ฟรี และไม่กิน VM production เลย**
- ได้ hot reload ระหว่างแก้ — ดีกว่าต้อง deploy ขึ้น test ทุกครั้งที่ขยับ CSS หนึ่งบรรทัด
- ต่อฐานข้อมูล dev ของตัวเอง ⇒ ทดลองแล้วข้อมูลลูกค้าไม่ขยับ
- ⚠ ห้ามใช้ quick tunnel (URL สุ่มใหม่ทุกครั้งที่รีสตาร์ต) ต้องเป็น named tunnel

**VM ที่สองเอาไว้ทำทีหลัง** ตอนที่มีลูกค้าจ่ายเงินหลายรายแล้วและการปล่อยเวอร์ชันต้องมี
การซ้อมก่อน — ไม่ใช่ตอนนี้ที่ยังเปลี่ยนฟีเจอร์ทุกวัน

### 0.7 ขอบเขต: **Mini App มีแค่หน้าบ้านของพนักงาน** (เจ้าของงานยืนยัน 2026-09-09)

งานผู้บริหาร/HR ทั้งหมดอยู่บนเว็บตามเดิม ไม่ย้ายเข้า Mini App

**กฎที่ใช้ตัดสินว่าหน้าไหนเข้า Mini App ได้** — ตรวจได้เป็นกลไก ไม่ใช่ความเห็น:

> ถ้าหน้าจอนั้นต้องการ permission ที่**ไม่ใช่** `*.self` หรือ `@RequirePermissions()` เปล่า
> ⇒ **หน้านั้นไม่เข้า Mini App**

workforce API แยก scope ไว้ให้แล้ว (`attendance.read.self`, `payslip.read.self`,
`leave.request`, `overtime.request`) ⇒ ใช้เส้นแบ่งที่มีอยู่ ไม่ต้องคิดใหม่

#### ผลพลอยได้ที่สำคัญ: Mini App ไม่ต้องมีระบบเมนู/สิทธิ์เลย

พนักงานทุกคนมีสิทธิ์ `.self` เท่ากันหมด ⇒ **ทุกคนเห็นหน้าจอชุดเดียวกัน** ไม่ต้อง port
`module-registry.ts` / `getVisibleModules()` / `Shell` มาฝั่ง Mini App · **Rich Menu ของ
LINE ทำหน้าที่ navigation แทน sidebar** ประหยัดงานไปมาก และเป็นเหตุผลเพิ่มที่ว่า
ทำเป็น route group ใหม่ถูกกว่าพยายามใช้ layout เดิม

#### API ฝั่งพนักงานที่ **มีพร้อมใช้แล้ว** (สำรวจ 2026-09-09)

| หน้าจอ | endpoint | สิทธิ์ |
|---|---|---|
| โปรไฟล์ตัวเอง | `GET /me` | authenticated |
| ลงเวลา 3 จังหวะ | `POST /time-events/photo-checkin-sessions` → `/evidence` → `/commit` | `attendance.read.self` |
| เครื่องที่ผูกไว้ / ลงทะเบียนเครื่อง | `GET /me/mobile-devices`, `POST /mobile-devices/enroll` | `attendance.read.self` |
| ใครมาแล้ววันนี้ (รวมของตัวเอง) | `GET /time-events?date=` | `@RequirePermissions()` เปล่า — เปิดกว้างโดยตั้งใจ |
| ขอลา / ใบลาของฉัน / ยกเลิก | `POST /leave-requests`, `GET /me/leave-requests`, `POST /leave-requests/:id/cancel` | `leave.request` |
| ประเภทการลา · ปฏิทินลาของทีม | `GET /leave-types`, `GET /leave-calendar` | authenticated |
| ขอ OT | `POST /overtime-requests` | `overtime.request` |
| สลิปของฉัน | `GET /me/payslips` | `payslip.read.self` |

⇒ **หน้าบ้านพนักงานแทบไม่ต้องเขียน API ใหม่เลย** ซึ่งยืนยันว่า "Mini App = หน้าบ้าน"
เป็นขอบเขตที่ทำได้จริงในเวลาอันสั้น

#### ที่ยังขาดและต้องทำเพิ่ม (3 อย่าง)

1. **เกรด/ผลงานของฉัน** — มี `listUserEvents(orgId, userId)` ใน `apps/web/lib/performance.ts`
   แล้ว แต่ยังไม่มี route ⇒ เพิ่ม route handler บาง ๆ ผูก `userId` จาก session เท่านั้น
2. **แจ้งเตือน mention ของฉัน** — maintenance มี `/api/notifications/maintenance` แล้ว
   แต่ report_task เก็บใน client store ⇒ ต้องมี API ฝั่ง server (สเปคเดิมข้อ 1 ของ
   [notifications-unified-spec.md](notifications-unified-spec.md) วางทางไว้แล้ว)
3. **ใบเบิกค่าใช้จ่าย (petty cash)** — `modules/maintenance/data/expenses.ts` เป็น
   server action ไม่มี REST API ⇒ ถ้าจะให้พนักงานถ่ายใบเสร็จส่งจาก Mini App ต้องเปิด
   route ให้ก่อน · **ยกไว้เฟสหลัง** อย่าเอามาถ่วงการลงเวลา

#### หน้าจอใน Mini App (เสนอ 4 หน้า พอและไม่บวม)

1. **"วันนี้"** (หน้าแรก) — ปุ่มเข้างาน/ออกงานเต็มความกว้าง + สถานะวันนี้ + กะ + แถบเตือน
   ถ้ายังไม่เป็นเพื่อนกับ OA
2. **ลา** — ขอลา + สถานะใบลาของฉัน + ปฏิทินว่าวันนั้นเพื่อนลาไปกี่คน
3. **แจ้งเตือน** — mention + เรื่องที่เกี่ยวกับตัวเอง (ช่องทางหลัก ไม่เสียค่าข้อความ)
4. **ของฉัน** — สลิป, เกรด/ผลงาน, เครื่องที่ผูกไว้, ออกจากระบบ

#### กฎที่รักษาทางออกไว้สำหรับวันที่อยากแยกเป็นแอปจริง

> **หน้าใน `app/(liff)/` ห้ามเรียก server action ของโมดูลอื่น** ให้คุยผ่าน route handler
> หรือ `wfFetch` เท่านั้น

ถ้าถือกฎนี้ Mini App จะเป็น thin client ที่พึ่งแต่ HTTP ⇒ วันหนึ่งยกออกไปเป็นโปรเจกต์
`SmartBoss-App` ของตัวเองได้โดยแทบไม่ต้องแก้ (ตรงกับกฎ "`actions.ts` ต้องบาง" ที่
[workflow.md](workflow.md) วางไว้) · ถ้าไม่ถือ จะผูกกับ Next ของเว็บจนแยกไม่ออกอีก

---

## 1. ของที่มีอยู่แล้ว vs ของที่ต้องสร้าง

**หลังบ้าน check-in location เสร็จแล้วทั้งหมด** อยู่ใน `apps/workforce-api` ซึ่ง deploy จริง
อยู่แล้ว (`deploy/systemd/smartboss-api.service`) — งานที่เหลือคือ **หน้าจอ + ตัวตน**
ไม่ใช่ domain logic

| มีแล้ว | ที่อยู่ |
|---|---|
| `workforce.sites` มี lat/lng/radius_m | `packages/workforce/db/src/schema/index.ts:84` |
| `evaluateCheckin()` คำนวณระยะ + ธงความเสี่ยง | `packages/workforce/domain/src/attendance/photo-policy.ts:139` |
| นโยบายรายกลุ่ม (บังคับพิกัด/รูป, รัศมี, max accuracy, WARN/REVIEW/REJECT) | `packages/workforce/contracts/src/checkin.ts:25` |
| flow 3 จังหวะ create session → evidence → commit | `apps/workforce-api/src/checkin/checkin.controller.ts:66-92` |
| ลงทะเบียนมือถือ 1 เครื่อง/คน + อนุมัติเครื่องที่ 2 | `apps/workforce-api/src/checkin/checkin.service.ts:72` |
| คิวตรวจหลักฐาน + presigned URL ดูรูป | `attendance-risk-assessments`, `attendance-evidence/:id/download-url` |
| ส่ง LINE push + log | `apps/web/modules/maintenance/data/notify.ts:133` |

| ยังไม่มี | หมายเหตุ |
|---|---|
| หน้าจอให้พนักงานกดเข้างาน | ไม่มีไฟล์ไหนใน `apps/web` เรียก `photo-checkin` เลย |
| LINE login / LIFF | `User.lineUserId` วันนี้ใช้ *ส่ง push เท่านั้น* ไม่ใช่ login |
| หน้าตั้งค่าสถานที่ `/hr/sites` | มี `GET`/`POST /sites` แต่ **ไม่มี `PATCH`** (ดูข้อ 4.1) |
| หน้าอนุมัติเครื่องมือถือ | `/hr/devices` วันนี้มีแต่เครื่องสแกนนิ้ว |
| คิวตรวจหลักฐานบนเว็บ | endpoint พร้อม ไม่มี UI |

---

## 2. โครงสร้างฝั่ง LINE (งาน console ไม่ใช่โค้ด)

ทำใน **provider เดียว** ของ Smartboss — ข้อนี้บังคับ ไม่ใช่คำแนะนำ (LINE กำหนดว่า
Messaging API channel ที่จะ link ต้องอยู่ provider เดียวกับ LINE Login channel
และคนทำต้องเป็น admin ของทั้งสอง channel)

1. **Messaging API channel** = OA กลาง "Smartboss" → ได้ channel access token (long-lived)
   + channel secret · สร้างใน provider เดียวกับข้อ 2 เสมอ
2. **LINE MINI App channel** → ได้ **channel ID สามชุด** (Developing / Review / Published)
   และ **LIFF ID สามชุด** พร้อม endpoint URL แยกกันต่อสภาพแวดล้อม (ดูตารางในข้อ 0.6)
   - `client_id` ที่ใช้ verify id token = channel ID **ของสภาพแวดล้อมที่เสิร์ฟอยู่**
     ⇒ dev ใช้ของ Developing, production ใช้ของ Published (คนละค่า อย่าสลับ)
3. ในแชนเนลข้อ 2 → เปิด **Add friend option** ชี้ไปที่ OA ข้อ 1
   - **จำเป็นจริง ๆ ไม่ใช่ของแถม**: push message ส่งได้เฉพาะคนที่ *เพิ่ม OA เป็นเพื่อนแล้ว*
     (หรือเคยคุย 1:1 ใน 7 วัน) ⇒ ถ้าไม่ผ่านจอนี้ พนักงานเข้าแอปได้ แต่
     **ไม่ได้รับแจ้งเตือนเลย** และไม่มี error ที่หน้าจอ
   - เสริมในแอปด้วย `liff.requestFriendship()` สำหรับคนที่กดข้ามไปแล้ว (ข้อ 3.3)
4. ของที่ console ขอก่อนสร้างได้: ไอคอน, ชื่อ, คำอธิบาย, **URL นโยบายความเป็นส่วนตัว
   (บังคับ)**, URL ข้อกำหนดการใช้งาน (ไม่บังคับ), อีเมลรับข่าว
5. Caddy **ไม่ต้องแก้** — `{$APP_DOMAIN}` reverse proxy เข้า Next อยู่แล้ว และมี HTTPS
   ซึ่ง Mini App บังคับ (`deploy/Caddyfile`)

### env ใหม่ (ทั้งหมดเป็นค่าระดับแพลตฟอร์ม ไม่ใช่รายบริษัท)

เพิ่มใน `.env.example` และ `deploy/smartboss.env.example`:

```
# ── LINE (OA กลาง — ดู docs/line-mini-app-checkin-spec.md) ──
# ทุก channel ต้องอยู่ใน provider เดียวกัน ไม่งั้น user ID ไม่ตรงกันและ push ไม่ถึง
#
# ⚠ สองตัวแรกเป็นค่า "ต่อสภาพแวดล้อม" — Mini App ออก channel/LIFF ID มา 3 ชุด
#   เครื่อง dev ใส่ของ Developing · production ใส่ของ Published
#   ใส่สลับกัน = verify id token ไม่ผ่านด้วย "Invalid IdToken Audience"
LINE_MINI_APP_CHANNEL_ID=       # client_id ที่ใช้ verify id token
NEXT_PUBLIC_LINE_LIFF_ID=       # ใส่ใน liff.init() ฝั่ง client — เปิดเผยได้
LINE_CHANNEL_ACCESS_TOKEN=      # ของ OA กลาง ใช้ push (ความลับ)
LINE_CHANNEL_SECRET=            # ตรวจลายเซ็น webhook (ความลับ)
```

> LIFF ID ต้องให้ client อ่านได้จึงขึ้นต้นด้วย `NEXT_PUBLIC_` · **อย่า** เอา 2 ตัวล่าง
> ไปขึ้นต้น `NEXT_PUBLIC_` เด็ดขาด · `deploy/smartboss.env.example` ถูกอ่านโดย systemd
> ⇒ ห้ามใส่คอมเมนต์ท้ายบรรทัดเดียวกับค่า (ดูหัวไฟล์นั้นข้อ 9)

---

## 3. สะพานตัวตน LINE → Smartboss (งานหลักจริง)

### 3.1 `app/api/auth/line/route.ts` (ไฟล์ใหม่)

รับ `POST { idToken: string }`

1. `rateLimit('line-login:' + ip, 10, 60)` — เหมือน login ปกติ
2. `POST https://api.line.me/oauth2/v2.1/verify` ด้วย `id_token` + `client_id`
   (= `LINE_MINI_APP_CHANNEL_ID`) → ได้ `sub`
   - **ต้อง verify ฝั่ง server เท่านั้น** ห้ามเชื่อ `liff.getProfile()` ที่ client ส่งมา
     เพราะ client ปลอม userId ของคนอื่นได้ = ลงเวลาแทนกันได้
   - LINE ตรวจให้เองว่า `aud` ตรงกับ `client_id` ที่ส่งไป (ไม่ตรง = `Invalid IdToken
     Audience`) แต่ให้เช็คซ้ำในโค้ดด้วย เผื่ออนาคตเปลี่ยนไป verify เอง
3. `prisma.user.findFirst({ where: { lineUserId: sub, isActive: true } })`
   - ไม่พบ → ตอบ `404 { code: 'NOT_LINKED' }` ให้หน้า LIFF พาไปหน้าผูกบัญชี (3.2)
4. ออก token ด้วย helper **ชุดเดียวกับ** `app/api/auth/login/route.ts:107-121`:
   `loadAuthUser()` → `signAccessToken()` → `issueRefreshToken()` →
   `setAccessCookie()` / `setRefreshCookie()`
5. `audit({ action: 'LOGIN_SUCCESS_LINE', ... })`

**กำไรจากการทำทางนี้:** token ที่ออกมาเป็นใบเดียวกับที่ workforce ตรวจอยู่แล้ว
(`AUTH_PROVIDER=smartboss`, secret ร่วม) ⇒ ได้ `orgId` + permission + `employmentId`
ฟรีทันที ไม่ต้องทำระบบสิทธิ์ชุดที่สองสำหรับมือถือ

### 3.2 การผูกบัญชีครั้งแรก (`lineUserId` ยังว่าง)

ให้กรอก email/password ครั้งเดียวในหน้า LIFF → เรียก login ปกติ → สำเร็จแล้วเขียน
`lineUserId = sub` ลง `User` (ต้อง verify idToken ฝั่ง server รอบนี้ด้วย)

เงื่อนไขที่ห้ามพลาด:

- `lineUserId` **ต้อง unique** — วันนี้ schema ยังไม่บังคับ (`core.prisma:16` เป็น
  `String?` เฉย ๆ) ⇒ เพิ่ม `@unique` พร้อม migration ไม่งั้นบัญชี LINE เดียวผูกได้หลาย
  พนักงาน และ `findFirst` จะได้คนผิดแบบสุ่ม
- ถ้าบัญชีนั้นมี `lineUserId` อยู่แล้วและไม่ตรงกับ `sub` ที่เพิ่ง verify = เปลี่ยนเครื่อง/
  เปลี่ยนบัญชี LINE ⇒ ต้อง audit ไว้ ไม่ใช่ทับเงียบ ๆ
- ทางเลือกที่ลื่นกว่าสำหรับพนักงานหน้างานที่ไม่มีอีเมล: ใช้แพตเทิร์นลิงก์ token ที่มีอยู่แล้ว
  ที่ `app/u/[token]/page.tsx` — HR กดสร้างลิงก์เชิญ ส่งให้พนักงาน เปิดใน LINE แล้วผูกเลย
  ไม่ต้องมีรหัสผ่าน

### 3.3 ตรวจว่าเป็นเพื่อนกับ OA แล้วหรือยัง

ในหน้า Mini App หลัง `liff.init()` เรียก `liff.getFriendship()` — ถ้า `friendFlag === false`
ขึ้นแถบเตือน "เพิ่มเพื่อน Smartboss เพื่อรับแจ้งเตือน" + ปุ่มที่เรียก
`liff.requestFriendship()` (เด้งหน้าต่างขอเพิ่มเพื่อน/ปลดบล็อกได้ทุกเมื่อ ไม่ต้องรอ
จอ consent ตอน login) · **ไม่ต้องบล็อกการลงเวลา** แค่บอกว่าจะไม่ได้รับแจ้งเตือน

---

## 4. หน้าจอที่ต้องสร้าง

### 4.1 `/hr/sites` — ตั้งค่าสถานที่ (ทำก่อนทุกอย่าง)

**ไม่มี site = check-in location ใช้งานไม่ได้เลย** เพราะ `evaluateCheckin()` หา site
ที่ใกล้ที่สุดจากรายการที่ส่งเข้าไป ถ้าว่างก็ไม่มีอะไรให้เทียบ

- `GET /sites` (ต้องมี `workforce.people.read`) + `POST /sites`
  (`workforce.settings.manage`) มีอยู่แล้ว — `createSiteSchema` บังคับว่า lat/lng
  ต้องมาคู่กัน
- ⚠ **ต้องเขียน `PATCH /sites/:siteId` เพิ่มใน NestJS** (controller + repository +
  audit) เพราะวันนี้ทั้ง controller มี `@Patch` แค่ `companies/:companyId` ตัวเดียว ·
  การย้ายหมุด/แก้รัศมีเป็นงานที่ HR ทำบ่อยที่สุด ปล่อยให้ลบ-สร้างใหม่ไม่ได้
  เพราะ site ถูกอ้างใน time event ย้อนหลัง
- UI: แผนที่ปักหมุด + ช่องรัศมี + ปุ่ม "ใช้ตำแหน่งปัจจุบัน" (คนตั้งค่ามักยืนอยู่ที่นั้น)

### 4.2 `app/(liff)/` — หน้าพนักงาน

- `layout.tsx` แยกจาก `(shell)` — ไม่มี sidebar/rail, viewport มือถือ, ไม่มีเมนูโมดูล
- `app/(liff)/checkin/page.tsx` = ปุ่มเข้างาน/ออกงานใหญ่เต็มจอ + สถานะวันนี้
- ขอพิกัดด้วย `navigator.geolocation.getCurrentPosition({ enableHighAccuracy: true })`
  แล้วส่งค่า `accuracy` ที่ได้ไปตรง ๆ **ห้ามปัดหรือแต่ง** เพราะ policy ใช้ค่านี้ตัดสิน
- ยิง 3 จังหวะผ่าน route handler บาง ๆ ของ Next (`app/api/liff/checkin/*`) ไม่ใช่ยิง
  workforce ตรงจาก browser เพราะ token อยู่ใน httpOnly cookie ที่ client อ่านไม่ได้
- แสดงผลลัพธ์ตาม `decision` ที่ API คืน: `ACCEPTED` / `ACCEPTED_WITH_WARNING` /
  `PENDING_REVIEW` (บอกว่ารอ HR ตรวจ) / `REJECTED_POLICY` (บอกเหตุผลจาก `risk_flags`
  เป็นภาษาคน เช่น "อยู่ห่างจากไซต์ 340 ม. เกินรัศมี 200 ม.")

### 4.3 เพิ่มในหน้าเดิม

- `/hr/settings` — แท็บ policy group (เลือก site, รัศมี, บังคับรูป/ไม่บังคับ, risk action)
- `/hr/devices` — แท็บอนุมัติเครื่องมือถือ (`me/mobile-devices`, `:id/approve`)
- `/hr` หรือ `/hr/attendance` — คิวตรวจรายการที่เป็น `PENDING_REVIEW`

---

## 5. แจ้งเตือนกลับฝั่งมือถือ + ย้าย LineConfig ขึ้น core

### 5.1 ปัญหาวันนี้

`LineConfig` อยู่ **schema `maintenance`** (`maintenance.prisma:379`) และเป็น
`@id orgId` = 1 แถว/บริษัท เก็บ `channelAccessToken` รายบริษัท · `sendLine()` ก็อยู่
ใน `modules/maintenance/data/notify.ts` ⇒ โมดูล HR ที่จะส่งผลอนุมัติ petty cash
และเกรด A-F ต้อง import ข้ามโมดูลไปหาของ maintenance ซึ่งผิดสัญญาโมดูล

### 5.2 ที่ต้องทำ

1. ย้าย `sendLine()` + `notifyUser()` ไปเป็นของกลาง (`apps/web/lib/notify/` หรือ
   `modules/notifications/server/`) แล้วให้ maintenance re-export ไว้ชั่วคราว
   เพื่อไม่ต้องแก้ผู้เรียกเดิมทั้งหมดในคอมมิตเดียว
2. ย้ายตารางขึ้น schema `core`
3. **token อ่านจาก env** (`LINE_CHANNEL_ACCESS_TOKEN`) ไม่ใช่จาก DB อีกแล้ว
4. **แต่ `enabled` ยังต้องเป็นค่ารายบริษัท** — บริษัทต้องปิดแจ้งเตือน LINE ได้ ตามกฎ
   "ห้าม hard code กฎธุรกิจ" ⇒ `LineConfig` ไม่หายไป แค่เหลือฟิลด์ตั้งค่า ไม่เก็บความลับ
5. ความเข้ากันได้ย้อนหลัง: ถ้าบริษัทใดเคยตั้ง OA ของตัวเองไว้แล้ว `lineUserId` ที่เก็บไว้
   **เป็นของ provider นั้น ใช้กับ OA กลางไม่ได้** ⇒ ต้องเช็คข้อมูล production ก่อน migrate
   ถ้ามีของเก่าอยู่ ต้องให้คนเหล่านั้นผูกบัญชีใหม่ผ่าน LIFF (ล้าง `lineUserId` ทิ้ง)
   อย่าคิดว่าย้าย token แล้วของเดิมจะใช้ต่อได้

### 5.3 รูปแบบข้อความ

ส่งเป็น Flex message พร้อมปุ่มลิงก์กลับเข้าแอป `https://liff.line.me/<LIFF_ID>?path=...`
เพื่อให้กดจากแชทแล้วเด้งเข้าหน้าที่เกี่ยวข้องทันที (อนุมัติ petty cash / ดูเกรดของตัวเอง)

---

## 6. แชท B2B กับพาร์ทเนอร์ (เฟสหลัง — ยังไม่ทำตอนนี้)

เรื่องนี้ **ไม่อยู่ใต้ OA กลาง** เพราะเป้าหมายคือยิงเข้า *กลุ่ม LINE เดิมของพาร์ทเนอร์*
ด้วย OA ของพาร์ทเนอร์เอง (พาร์ทเนอร์สร้างลิงก์เชิญให้ทีมเราเป็นแอดมิน → เอา access
token มาตั้ง webhook → พาร์ทเนอร์ไม่ต้องแตะโค้ด)

⇒ ต้องมีตารางใหม่แบบ **หลายแถวต่อบริษัท** เช่น `core.line_channels`
(`orgId`, `partnerName`, `channelAccessToken` เข้ารหัส, `channelSecret`, `targetId`,
`kind`) — ใช้ `LineConfig` ที่เป็น `@id orgId` ทำไม่ได้

ออกแบบตารางนี้ตอนจะทำจริง อย่าเขียนรอไว้ก่อน

---

## 7. ลำดับลงมือ

1. ตั้ง provider + OA + Login channel + LIFF ใน console แล้วใส่ env (ข้อ 2)
2. `lineUserId` → `@unique` + migration
3. `app/api/auth/line/route.ts` + หน้าผูกบัญชีครั้งแรก (ข้อ 3)
4. `/hr/sites` UI + `PATCH /sites/:siteId` + สร้าง policy group จริง 1 กลุ่ม (ข้อ 4.1)
5. `app/(liff)/checkin` — ทดสอบโดยเดินออกนอกรัศมีจริงแล้วดูว่าธงขึ้นถูก (ข้อ 4.2)
6. คิวตรวจ + อนุมัติเครื่องมือถือ (ข้อ 4.3)
7. ย้าย `sendLine` ขึ้น core + **ตัวนับโควตารายบริษัท** แล้วค่อยต่อแจ้งเตือน
   petty cash / เกรด (ข้อ 5 + 0.1.1) — ตัวนับต้องมาพร้อมกับการส่ง ไม่ใช่ตามมาทีหลัง
8. Rich Menu + webhook ตอบด้วย reply message (ของฟรี) สำหรับเมนูที่พนักงานกดเอง

---

## 8. กับดัก

1. **`DEFAULT_POLICY` เข้มมาก** (`apps/workforce-api/src/checkin/checkin.service.ts:36`)
   สำหรับพนักงานที่ยังไม่ถูกจัดกลุ่ม: บังคับถ่ายรูป *ทุกครั้ง* + เครื่องต้องได้รับอนุมัติ
   ⇒ สร้าง policy group ให้ครบ **ก่อน** เปิดใช้ · และตามกฎ "ห้าม hard code"
   **ห้ามแก้ค่าในคอนสแตนต์นี้เพื่อให้ใช้งานง่ายขึ้น** ให้ตั้งผ่าน policy group เสมอ
2. **`employmentId` เป็น null แล้ว commit ไม่ได้** — `requireEmployment()` โยน error
   ทันที เงื่อนไขคือ principal ต้องมี `personId` และมีแถว `employments`
   ⇒ ต้องรัน `pnpm wf:sync` และตรวจว่าพนักงานคนนั้นมี employment จริง
   อาการที่จะเจอ: พนักงานกดปุ่มแล้วขึ้น error ทั้งที่พิกัดถูกต้องทุกอย่าง
3. **push ไม่ถึงเพราะยังไม่เป็นเพื่อนกับ OA** — ไม่มี error ที่หน้าจอพนักงาน
   ดูได้จาก `LineNotificationLog.success = false` เท่านั้น ⇒ เปิด Add friend option
   แบบ `aggressive` และเช็ค `liff.getFriendship()` (ข้อ 3.3)
4. **โควตาข้อความเป็นของ Smartboss ทั้งก้อน และหมดแล้ว LINE ตอบ error ไม่ส่งให้เลย**
   ⇒ แจ้งเตือนของลูกค้าทุกรายดับพร้อมกันกลางเดือนได้จริง · ต้องนับ+คุมรายบริษัทจาก
   `LineNotificationLog` ตั้งแต่วันแรก ไม่ใช่ตามไปนับทีหลัง (รายละเอียดข้อ 0.1.1)
5. **workforce API ต้องรันอยู่** (`http://127.0.0.1:4100/api/workforce/v1`)
   ไม่งั้นได้ `WorkforceUnavailableError` — หน้า LIFF ต้องขึ้นข้อความที่พนักงานเข้าใจ
   ไม่ใช่จอขาว เพราะพนักงานหน้างานไม่มีทางรู้ว่า API คืออะไร

---

## 9. ลงมือบนระบบที่ใช้งานจริงอยู่แล้ว — อะไรกระทบ อะไรไม่กระทบ

`app.easyboss.app` มีคนใช้จริงอยู่ ⇒ คำถามไม่ใช่ "กระทบไหม" แต่เป็น
**"ทำให้มันไม่กระทบได้ยังไง"** ซึ่งทำได้ และถูกกว่าการสร้างสภาพแวดล้อมที่สองมาก

### 9.1 กฎข้อเดียวที่ทำให้ deploy ลงของจริงได้ตั้งแต่วันแรก

> **env ที่ยังไม่ได้ตั้ง = ฟีเจอร์ปิดตัวเองเงียบ ๆ ไม่ใช่โปรเซสล้ม**

อ่าน env ของ LINE แบบ optional เสมอ: ไม่มี `LINE_MINI_APP_CHANNEL_ID` ⇒
`app/api/auth/line` ตอบ 503 และหน้า Mini App ขึ้นข้อความว่ายังไม่เปิดใช้ —
**ห้าม throw ตอน import หรือตอน start** เพราะ Next ที่ล้มตอนบูตคือทั้งเว็บดับ

ได้ผลเท่า feature flag โดยไม่ต้องมีระบบ flag: โค้ดขึ้น production ไปนอนรออยู่ได้
ลูกค้าไม่เห็นอะไรเปลี่ยน แล้วค่อย "เปิด" ด้วยการเติม 4 บรรทัดใน
`/etc/smartboss/smartboss.env` + `systemctl restart smartboss-web` ตอนที่พร้อม

⚠ ลำดับสำคัญ: **เติม env ก่อน แล้วค่อย deploy โค้ด** ถ้าทำกลับกันแล้วโค้ดดันอ่าน
env แบบบังคับ เว็บจะไม่ขึ้นเลย

### 9.2 แยกงานเป็น 3 ระดับความเสี่ยง

**ระดับ A — เพิ่มของใหม่ ไม่แตะของเดิม (ทำได้เลย ความเสี่ยงเกือบศูนย์)**

- `app/(liff)/**` — route group ใหม่ ไม่มีลิงก์จากที่ไหน ใครไม่รู้ URL ก็ไม่เจอ
- `app/api/auth/line/route.ts`, `app/api/liff/**` — endpoint ใหม่
- `PATCH /sites/:siteId` ใน workforce-api — เพิ่ม route ไม่แก้ของเดิม
- `/hr/sites` หน้าใหม่ + เพิ่มเมนูใน `modules/hr/manifest.ts`
  (กระทบแค่ sidebar ของคนที่มี `settings.manage` และเป็นการ *เพิ่ม* เมนู)
- webhook endpoint ของ LINE — ไม่มีใครยิงเข้ามาจนกว่าจะตั้ง URL ใน console

**ระดับ B — แตะโครงฐานข้อมูลจริง (ทำได้ แต่ต้องตรวจก่อน)**

`lineUserId` → `@unique` · ตรวจข้อมูลจริงก่อนเขียน migration:

```sql
SELECT line_user_id, count(*) FROM core.users
WHERE line_user_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```

- Postgres ยอมให้มี `NULL` ซ้ำได้ในดัชนี unique ⇒ ผู้ใช้ที่ยังไม่ผูก LINE ไม่มีปัญหา
- ถ้า query ข้างบนได้แถวออกมา migration จะ **ล้ม** แต่ล้มแบบปลอดภัย:
  `release.sh` ตรวจ `prisma migrate status` แล้ว **ปฏิเสธที่จะ deploy** ถ้ามี migration
  ค้าง ⇒ อาการคือ "ปล่อยเวอร์ชันไม่ได้" ไม่ใช่ "ข้อมูลเสีย"
- ตาราง `users` เล็ก ⇒ สร้างดัชนีล็อกแค่มิลลิวินาที ไม่ต้องใช้ `CONCURRENTLY`
- migration ไม่ถูกรันโดย `release.sh` โดยตั้งใจ — ต้องสั่ง `pnpm db:deploy` เอง
  **ทำตอนมีเวลาดูผล ไม่ใช่ตอนรีบ**

**ระดับ C — ห้ามทำพร้อมกับงานนี้**

**การย้าย `LineConfig` + `sendLine()` จาก maintenance ขึ้น core (ข้อ 5)**
โมดูลซ่อมบำรุงกำลังส่งแจ้งเตือน LINE ให้ลูกค้าอยู่ *ตอนนี้* ⇒ รีแฟคเตอร์ทางส่งที่ของจริง
พึ่งอยู่ พร้อมกับการต่อ OA กลางที่ยังไม่เคยรันเลย = ถ้าพัง จะแยกไม่ออกว่าพังเพราะอะไร
และอาการคือ "ช่างไม่ได้รับแจ้งงาน" ซึ่งไม่มีใครเห็นจนกว่าจะมีคนโทรมาบ่น

**ทำแบบนี้แทน:** เขียนตัวส่งของ OA กลางขึ้นมา *ใหม่ข้าง ๆ* (`lib/notify/line.ts`
อ่าน token จาก env) ปล่อยทางเดิมของ maintenance ทำงานต่อไปไม่ต้องแตะ ·
มีตัวส่ง 2 ตัวอยู่ร่วมกันชั่วคราวดูไม่สวย แต่ปลอดภัยกว่ามาก · รวมร่างทีหลังเมื่อทางใหม่
วิ่งจริงมาแล้วหลายสัปดาห์ แล้วค่อยย้ายที่เดียวจบ

### 9.3 ลำดับปล่อยของที่ความเสี่ยงต่ำสุด

1. ตั้ง Mini App channel **dev** + Cloudflare Tunnel (ข้อ 0.6) — ไม่แตะ production เลย
2. ทำฟีเจอร์ให้เสร็จบน dev จนใช้ได้จริง รวมทดสอบเดินออกนอกรัศมี
3. ลง migration ระดับ B บน production ตอนคนใช้น้อย (`pnpm db:deploy`)
4. deploy โค้ดขึ้น production **โดยยังไม่เติม env ของ LINE** ⇒ ฟีเจอร์ปิดอยู่
   ลูกค้าไม่เห็นความเปลี่ยนแปลง และได้ยืนยันว่าโค้ดใหม่ไม่ทำของเดิมพัง
5. สร้าง Mini App channel **production** ชี้ `app.easyboss.app` แล้วเติม env + restart
6. เปิดให้พนักงานบริษัทของเจ้าของงานใช้ก่อนบริษัทเดียว (ใช้ `OrgModule` คุมอยู่แล้ว)
7. ยื่น review ขอ verified Mini App หลังใช้จริงนิ่งแล้ว
8. ค่อยกลับมาทำระดับ C (รวมทางส่ง LINE)
