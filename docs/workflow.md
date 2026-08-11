# จากแก้โค้ดจนขึ้น production — รอบการทำงานเต็ม

ตัวอย่างในเอกสารนี้ใช้ `module/report_task` แต่ทุกโมดูลทำเหมือนกันหมด
เปลี่ยนแค่ชื่อสาขา

> **คำสั่งไหนรันที่ไหน** ดู [`commands.md`](commands.md) · **ใครดูแลอะไร** ดู [`branches.md`](branches.md)

---

## เข้าใจก่อน 1 ข้อ ไม่งั้นจะพลาดแน่นอน

**การ deploy ไม่ได้ปล่อยเฉพาะโมดูลของคุณ — มันปล่อยทุกอย่างที่อยู่ใน `main` ตอนนั้น**

เซิร์ฟเวอร์ไม่รู้จักคำว่า "โมดูล" เลย มันเห็นแค่ `main` ก้อนเดียว ⇒

- เพื่อนร่วมทีม merge อะไรเข้า `main` ไว้ **ของนั้นจะขึ้น production พร้อมกับของคุณ**
- ถ้าโมดูลของคนอื่น typecheck ไม่ผ่าน **build ของคุณจะล้ม** ทั้งที่โค้ดคุณถูก
- เว็บทั้งเว็บรีสตาร์ตพร้อมกัน ไม่ใช่แค่หน้าของโมดูลคุณ

**ก่อนกด deploy ให้ดูก่อนเสมอว่ากำลังจะปล่อยของใคร** (ดูขั้นที่ 8)

---

## 🅰 บนเครื่องตัวเอง

### 1. เริ่มงาน — ดึงของกลางล่าสุดมาก่อน

```bash
git checkout module/report_task
git fetch origin
git rebase origin/main
pnpm install --frozen-lockfile
```

**ทำไมต้อง rebase ก่อนเริ่ม ไม่ใช่ตอนจะ push** — ถ้าเขียนโค้ดเสร็จแล้วค่อย rebase
คุณจะเจอ conflict บนโค้ดที่เขียนไปตั้งเยอะแล้ว แก้ยากกว่ากันมาก
rebase ตั้งแต่ยังไม่มีอะไรจะไม่มีอะไรให้ชน

ถ้า `pnpm install` บอกว่า lockfile ไม่ตรง แปลว่ามีคนเพิ่ม dependency ใน `main`
อย่าใช้ `--no-frozen-lockfile` หนี ให้ rebase ให้เรียบร้อยก่อน

### 2. แก้โค้ด

รันดูผลที่ http://127.0.0.1:3100 (ต้องรันจากใน WSL — ดู [`commands.md`](commands.md))

```bash
wsl
cd /mnt/d/katawutntp/Easyboss
PORT=3100 bash wsl-dev.tmp.sh
```

### 3. ถ้าแก้ฐานข้อมูลด้วย

แก้ `packages/database/prisma/schema/report_task.prisma` แล้วสร้าง migration

```bash
# ใน WSL
pnpm db:migrate --name add_task_label
```

**⚠ ต้อง rebase ให้ทันก่อนสร้าง migration เสมอ** — migration เขียนบนสภาพฐานข้อมูล
ณ ตอนนั้น ถ้าฐานของคุณเก่ากว่า `main` จะได้ไฟล์ที่รันบน production ไม่ได้

**⚠ migration ที่ push ไปแล้ว ห้ามแก้เนื้อใน** Prisma เก็บ checksum ไว้ ⇒
แก้แล้วมันจะปฏิเสธทั้งชุด ไม่ใช่แค่ไฟล์นั้น · แก้ผิดให้เขียน migration ตัวใหม่ทับ

### 4. ตรวจ 4 อย่างก่อน commit

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

**หยุด dev server ก่อน build** — build เขียนทับ `.next` ที่ dev server ใช้อยู่
จะได้ `ChunkLoadError` ที่หน้าตาเหมือนโค้ดพัง ทั้งที่โค้ดไม่ผิด

```bash
pkill -f 'next dev'; sleep 2; pgrep -af 'next dev'   # ต้องว่าง
```

### 5. commit แล้ว push

```bash
git add -A
git commit -m "feat(report_task): เพิ่มป้ายสีให้งานในบอร์ด"
git push --force-with-lease
```

**ทำไมต้อง `--force-with-lease`** — ขั้นที่ 1 คุณ rebase ไป ประวัติของสาขาจึงถูกเขียนใหม่
ไม่ตรงกับที่อยู่บน GitHub · `--force-with-lease` ต่างจาก `--force` ตรงที่
**ถ้ามีคนอื่น push เข้าสาขาเดียวกันหลังจากคุณ fetch ครั้งล่าสุด มันจะปฏิเสธ**
แทนที่จะลบงานเขาทิ้ง — ใช้ตัวนี้เสมอ อย่าใช้ `--force` เปล่า ๆ

---

## 🐙 บน GitHub — เอาเข้า `main`

### 6. เปิด Pull Request

`module/report_task` → `main`

**ทำไมต้องผ่าน PR ไม่ push เข้า main ตรง ๆ**
- มีที่ให้คนอื่นเห็นว่าคุณกำลังจะเปลี่ยนอะไร ก่อนที่มันจะขึ้น production
- GitHub บอกได้ทันทีว่าชนกับของใคร
- ย้อนกลับง่าย — revert ทั้ง PR ได้ในคลิกเดียว

### 7. merge

หลัง merge แล้ว **บอกทีมว่า `main` ขยับ** โดยเฉพาะถ้าคุณแตะของกลาง
(`packages/ui/` · `core.prisma` · `apps/web/components/` · `module-registry.ts`)

---

## 🅱 บนเซิร์ฟเวอร์ — deploy

### 8. ดูก่อนว่ากำลังจะปล่อยอะไร

```bash
cd /opt/smartboss
sudo -u smartboss git fetch origin
git log --oneline HEAD..origin/main
```

จะเห็นทุกคอมมิตที่กำลังจะขึ้น **รวมของคนอื่นด้วย** — ถ้าเห็นของที่ไม่รู้จัก
ให้ถามเจ้าของก่อน อย่าเพิ่งกด

> ⚠ `git fetch` **ต้องมี `sudo -u smartboss`** เพราะ repo เป็นของ user นั้น
> ถ้าลืม จะได้ `cannot open '.git/FETCH_HEAD': Permission denied` แล้ว `origin/main`
> จะค้างเป็นของเก่า ⇒ คำสั่งถัดไปไม่แสดงอะไรเลย ซึ่งอ่านแล้วนึกว่า "ไม่มีอะไรใหม่"

ดูว่าเป็นการเปลี่ยนโค้ดจริงหรือแค่เอกสาร/คอมเมนต์:

```bash
git diff HEAD origin/main -- apps/ packages/
```

ว่างเปล่า หรือมีแต่คอมเมนต์ = **ไม่ต้อง deploy**

### 9ก. ไม่มี migration — คำสั่งเดียวจบ

```bash
sudo -u smartboss bash deploy/release.sh
```

สคริปต์ทำให้เอง 6 ขั้น: `git pull` → `pnpm install` → `prisma generate` →
เช็ค migration ค้าง → `build` → รีสตาร์ต 4 บริการ → รอจนเว็บตอบได้

ใช้เวลาราว **5–10 นาที** · เว็บดับช่วงรีสตาร์ตประมาณ **10–20 วินาที**

### 9ข. มี migration — เรียงตามนี้ ห้ามสลับ

```bash
# 1. สำรองก่อนเสมอ (migration ย้อนกลับไม่ได้)
sudo bash /opt/smartboss/deploy/backup.sh

# 2. ดึงโค้ด
cd /opt/smartboss && sudo -u smartboss git pull

# 3. ดูก่อนว่าค้างกี่ตัว — ยังไม่แตะฐานข้อมูล
sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a;
  pnpm --filter @smartboss/database exec prisma migrate status'

# 4. ลงจริง
sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a;
  pnpm db:deploy && pnpm wf:migrate'

# 5. build + รีสตาร์ต
sudo -u smartboss bash deploy/release.sh
```

**ทำตอนที่มีเวลานั่งดูผล ไม่ใช่ตอนรีบ** — ถ้า migration ทำข้อมูลเสีย ทางเดียวคือกู้จาก backup

### 10. ตรวจหลัง deploy

```bash
systemctl --no-pager --lines=0 status smartboss-web smartboss-api smartboss-worker smartboss-gateway
curl -s http://127.0.0.1:4100/api/workforce/v1/health; echo
curl -so /dev/null -w "เว็บ %{http_code}\n" http://127.0.0.1:3000/login
```

ต้อง `active (running)` ทั้ง 4 · API ตอบ JSON · เว็บ 200

**แล้วเปิดเบราว์เซอร์จริงกด F12 → Console** — หน้าที่เป็น client component
พังหลัง hydrate ได้โดยที่ `curl` ยังตอบ 200 (เคยเจอมาแล้วกับ `/report-task`)

---

## มีผลอะไรกับคนอื่นบ้าง

### ระหว่างที่ยังอยู่ในสาขา — ไม่มีผลเลย

push เข้า `module/report_task` กี่ครั้งก็ได้ ไม่มีใครเห็น ไม่มีอะไรขึ้น production
สาขาอื่นไม่รู้ด้วยซ้ำว่าคุณทำอะไรอยู่

### ตอน merge เข้า `main` — คนอื่นต้อง rebase

| คุณแตะอะไร | ผลกับสาขาอื่น |
|---|---|
| เฉพาะ `modules/report_task/` | rebase ผ่านฉลุย ไม่มี conflict |
| `packages/ui/` (ปุ่ม การ์ด สี) | หน้าจอทุกโมดูลเปลี่ยนตาม — ต้องบอกทีม |
| `core.prisma` | **ทุกคนต้อง rebase ก่อนสร้าง migration ตัวถัดไป** |
| `module-registry.ts` · `lib/icons.ts` | เมนูของทุกโมดูล — conflict ง่ายมาก |
| `pnpm-lock.yaml` | ทุกคนต้อง `pnpm install` ใหม่ |

⇒ **ถ้าแตะแต่โฟลเดอร์โมดูลตัวเอง แทบไม่กระทบใครเลย** ปัญหาเกิดตอนแตะของกลาง
ซึ่งกติกาคือ [แก้ของกลางให้ทำบน `main`](branches.md#-ของกลางที่ทุก-branch-แตะได้--แต่ไม่ควรแตะจากที่นี่) แล้วให้คนอื่น rebase ตาม

### ตอน deploy — กระทบทุกคนที่ใช้งานอยู่

- **เว็บดับ 10–20 วินาที** ทุกหน้า ทุกโมดูล (Next.js เป็น process เดียว)
- คนที่กำลังกรอกฟอร์มค้างอยู่ จะกดบันทึกไม่ได้ช่วงนั้น
- **เลี่ยงเวลา 8:00 กับ 17:00** เพราะ cron รันงานประจำวันอยู่
- **เลี่ยงตี 2:30 – ตี 3** เพราะกำลังสำรองข้อมูล

⇒ deploy ช่วงคนใช้น้อย และบอกทีมก่อน

### ถ้า deploy แล้วพัง — ย้อนกลับ

```bash
cd /opt/smartboss
git log --oneline -5                              # หาคอมมิตก่อนหน้า
sudo -u smartboss git checkout <คอมมิตเดิม>
sudo -u smartboss bash deploy/release.sh --no-pull
```

**ย้อนโค้ดได้ แต่ย้อน migration ไม่ได้** — ถ้ารอบนั้นมี migration ต้องกู้จาก backup
นี่คือเหตุผลที่ขั้นที่ 9ข ให้สำรองก่อนเสมอ

---

## สรุปเป็นคำสั่งล้วน

```bash
# 🅰 เครื่องตัวเอง
git checkout module/report_task
git fetch origin && git rebase origin/main
pnpm install --frozen-lockfile
#   ...แก้โค้ด...
pnpm typecheck && pnpm lint && pnpm test && pnpm build
git add -A && git commit -m "..."
git push --force-with-lease

# 🐙 GitHub: เปิด PR → merge เข้า main

# 🅱 เซิร์ฟเวอร์
cd /opt/smartboss
sudo -u smartboss git fetch origin
git log --oneline HEAD..origin/main          # กำลังจะปล่อยอะไร (รวมของคนอื่น)
sudo bash deploy/backup.sh                   # ถ้ามี migration
sudo -u smartboss bash deploy/release.sh
systemctl --no-pager --lines=0 status smartboss-web smartboss-api smartboss-worker smartboss-gateway
```
