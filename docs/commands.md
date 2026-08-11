# รันคำสั่งไหน ที่ไหน

เอกสารนี้มีไว้ให้ทุกคนในทีมทำเหมือนกัน — ถ้าไม่แน่ใจว่าคำสั่งไหนรันที่ไหน ดูที่นี่

---

## มี 3 ที่ให้รันคำสั่ง อย่าสับสน

| # | ที่ไหน | เปิดยังไง | สังเกตจาก prompt |
|---|---|---|---|
| 🅰 | **เครื่องตัวเอง** | เปิด terminal ที่โฟลเดอร์โปรเจกต์ | `d:\katawutntp\Easyboss>` |
| 🅱 | **เซิร์ฟเวอร์ production** | Google Cloud → VM instances → ปุ่ม **SSH** | `...@smartboss-prod:~$` |
| 🅲 | **Cloud Shell** | ไอคอน `>_` แถบบนของ Google Cloud | `...@cloudshell:~$` |

**กฎ**
- คำสั่งที่ขึ้นต้นด้วย `gcloud` → 🅲 เท่านั้น (🅱 ไม่มีสิทธิ์ จะขึ้น `insufficient authentication scopes`)
- **ถ้า prompt เป็น `smartboss=#` แปลว่าอยู่ในโปรแกรม psql ไม่ใช่ใน shell** —
  พิมพ์คำสั่ง Linux ตรงนั้นไม่ได้ ออกด้วย `\q` (backslash ไม่ใช่ `/q`) ก่อน
- คำสั่งที่แตะไฟล์ใน `/opt/smartboss` → 🅱 และต้องนำหน้าด้วย `sudo -u smartboss`
- `pnpm dev` / `pnpm build` ตอนพัฒนา → 🅰 เท่านั้น **ห้ามรันบนเซิร์ฟเวอร์เอง** ให้ใช้ `release.sh`

---

## 🅰 บนเครื่องตัวเอง — งานประจำวัน

### เริ่มงานใหม่ทุกครั้ง

```bash
git checkout module/<โมดูลของคุณ>
git fetch origin
git rebase origin/main
pnpm install --frozen-lockfile
```

**rebase ก่อนเสมอ** โดยเฉพาะก่อนสร้าง migration — ไม่งั้นเขียนบนฐานที่ไม่ตรงกับของจริง

### รันดูหน้าเว็บ

Postgres อยู่ใน WSL ⇒ **ต้องรัน Next จากใน WSL ด้วย** (Windows ต่อ Postgres ใน WSL ไม่ได้)

```bash
wsl
cd /mnt/d/katawutntp/Easyboss
PORT=3100 bash wsl-dev.tmp.sh
```

เปิด http://127.0.0.1:3100

> ⚠ ถ้าขึ้น `EADDRINUSE` แปลว่ามีเซิร์ฟเวอร์ตัวเก่าค้างอยู่ **อย่าเปลี่ยนพอร์ตหนี**
> เพราะคำขอจะไปเข้าตัวเก่าที่รันโค้ดเก่า แล้วคุณจะทดสอบผิดตัวโดยไม่รู้ตัว
> ```bash
> pkill -f 'next dev'; sleep 2; pgrep -af 'next dev'   # ต้องว่าง
> ```

### แก้ฐานข้อมูล

```bash
# 1. แก้ไฟล์ schema ของโมดูลตัวเอง
#    packages/database/prisma/schema/<โมดูล>.prisma

# 2. สร้าง migration (รันใน WSL)
wsl
cd /mnt/d/katawutntp/Easyboss
pnpm db:migrate --name อธิบายสั้นๆ_เป็นอังกฤษ
```

**ห้าม** แก้ไฟล์ migration ที่ push ไปแล้ว — Prisma เก็บ checksum ไว้ ไม่ตรงจะปฏิเสธทั้งชุด
แก้ผิดให้เขียน migration ตัวใหม่ทับ

### ก่อน commit ทุกครั้ง — ครบ 4 ข้อ

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

> ⚠ **หยุด dev server ก่อน build** — build เขียนทับ `.next` ที่เซิร์ฟเวอร์ตัวเก่าใช้อยู่
> จะได้ `ChunkLoadError` ที่หน้าตาเหมือนโค้ดพัง ทั้งที่โค้ดไม่ผิด

### ก่อนบอกว่า "พร้อม deploy" — ตรวจของที่อยู่ใน repo จริง

```bash
git archive HEAD | tar -x -C /tmp/fresh
cd /tmp/fresh && pnpm install --frozen-lockfile && pnpm build
```

build ผ่านบนเครื่องตัวเองพิสูจน์แค่ว่า *โค้ดบนดิสก์เรา* ใช้ได้
ไม่ได้พิสูจน์ว่า *สิ่งที่อยู่ใน repo* ใช้ได้ — เคยมีไฟล์หายไป 2,652 บรรทัดเพราะ `.gitignore`
โดยที่เครื่อง dev build ผ่านตลอด

### หน้าเว็บที่เป็น client component ต้องเปิดในเบราว์เซอร์จริง

`curl` ได้ 200 ไม่ได้แปลว่าใช้งานได้ — crash ที่เกิดหลัง hydrate มองไม่เห็นจาก curl
เปิดเบราว์เซอร์แล้วกด **F12 → Console** ดูว่ามีสีแดงไหม

---

## 🅱 บนเซิร์ฟเวอร์ — deploy

### ต้อง deploy ไหม — เช็คก่อน

```bash
cd /opt/smartboss
sudo -u smartboss git fetch origin      # ต้องมี sudo -u smartboss ไม่งั้น Permission denied
git log --oneline -1                    # เซิร์ฟเวอร์อยู่ที่ commit ไหน
git diff --name-only HEAD origin/main | grep -vE "^docs/|^scripts/|\.md$"
```

**บรรทัดสุดท้ายว่าง = ไม่ต้อง deploy**

| เปลี่ยนอะไร | deploy ไหม |
|---|---|
| โค้ดใน `apps/` `packages/` ที่มีผลต่อการทำงาน | ✅ |
| schema / migration | ✅ ต้องลง migration ก่อนด้วย |
| `docs/` `scripts/` `README` · คอมเมนต์ · lint config | ❌ |

> ⚠ `git fetch` โดยไม่มี `sudo -u smartboss` จะล้มด้วย
> `cannot open '.git/FETCH_HEAD': Permission denied` แล้ว `origin/main` จะเป็นของเก่า
> ⇒ การเทียบได้ผลว่างเปล่าซึ่งดูเหมือน "ไม่มีอะไรใหม่" ทั้งที่จริงมี

### ปล่อยเวอร์ชันใหม่ (ไม่มี migration)

```bash
cd /opt/smartboss
sudo -u smartboss bash deploy/release.sh
```

### ปล่อยเวอร์ชันใหม่ (มี migration) — เรียงตามนี้ ห้ามสลับ

```bash
# 1. สำรองก่อนเสมอ
sudo bash /opt/smartboss/deploy/backup.sh

# 2. ดึงโค้ด
cd /opt/smartboss && sudo -u smartboss git pull

# 3. ดูก่อนว่าค้างกี่ตัว
sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a;
  pnpm --filter @smartboss/database exec prisma migrate status'

# 4. ลง migration
sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a;
  pnpm db:deploy && pnpm wf:migrate'

# 5. build + รีสตาร์ต  (release.sh สร้าง Prisma client ใหม่ให้เองแล้ว)
sudo -u smartboss bash deploy/release.sh
```

> **ถ้า build ล้มด้วย `'code' does not exist in type ...`** แปลว่า Prisma client
> บนเซิร์ฟเวอร์ยังเป็นตัวเก่า ไม่รู้จักคอลัมน์ที่เพิ่งเพิ่ม — สร้างใหม่แล้วลองอีกครั้ง
> ```bash
> sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; pnpm db:generate'
> ```

**ทำตอนที่มีเวลาดูผล ไม่ใช่ตอนรีบ** — migration ย้อนกลับไม่ได้ ต้องกู้จาก backup

### ตรวจหลัง deploy

```bash
systemctl --no-pager --lines=0 status smartboss-web smartboss-api smartboss-worker smartboss-gateway
curl -s http://127.0.0.1:4100/api/workforce/v1/health; echo
curl -so /dev/null -w "เว็บ %{http_code}\n" http://127.0.0.1:3000/login
```

ต้อง `active (running)` ทั้ง 4 · API ตอบ JSON · เว็บ 200

### ดู log เวลาพัง

```bash
sudo journalctl -u smartboss-web -n 100 --no-pager
sudo journalctl -u smartboss-api -n 100 --no-pager
sudo -u smartboss docker compose -f /opt/smartboss/deploy/docker-compose.yml logs --tail=50 caddy
```

### เข้าฐานข้อมูล

```bash
sudo bash /opt/smartboss/deploy/psql.sh
sudo bash /opt/smartboss/deploy/psql.sh -c "select code, name from core.organizations;"
```

> ⚠ ตาราง `workforce.*` จะได้ 0 แถวเสมอถ้าไม่ตั้ง tenant context — ดู `docs/deploy.md` ข้อ 11.5

---

## 🅲 Cloud Shell — เรื่องของ Google Cloud

```bash
# เช็ค IP ว่าเป็น static แล้วหรือยัง
gcloud compute addresses list --regions=asia-southeast1

# เช็ค firewall
gcloud compute firewall-rules list --filter="targetTags:(http-server OR https-server)"

# ต่ออุโมงค์มาดู Prisma Studio ที่เครื่องตัวเอง
gcloud compute ssh smartboss-prod --zone=asia-southeast1-c -- -N -L 5555:127.0.0.1:5555
```

---

## ห้ามทำ

| ห้าม | เพราะ |
|---|---|
| `git push --force` ใส่ `main` | ลบงานคนอื่น |
| แก้ไฟล์ migration ที่ push แล้ว | checksum ไม่ตรง Prisma ปฏิเสธทั้งชุด |
| `docker volume rm smartboss_pgdata` | **ลบฐานข้อมูลทั้งหมด** |
| `pnpm db:migrate` บนเซิร์ฟเวอร์ | สร้าง migration ใหม่บน production — ใช้ `db:deploy` |
| build ทับตอน server รันอยู่ | `ChunkLoadError` ที่ดูเหมือนโค้ดพัง |
| commit ไฟล์ `.env` | ความลับหลุด (มี `.gitignore` กันไว้แล้ว อย่าไปแก้) |

---

## สรุปคำสั่งที่ใช้บ่อยที่สุด

```bash
# 🅰 เครื่องตัวเอง
git fetch origin && git rebase origin/main    # ก่อนเริ่มงาน
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # ก่อน commit

# 🅱 เซิร์ฟเวอร์
sudo bash /opt/smartboss/deploy/backup.sh     # ก่อนแตะฐานข้อมูล
sudo -u smartboss bash deploy/release.sh      # ปล่อยเวอร์ชันใหม่
sudo journalctl -u smartboss-web -n 50 --no-pager   # เวลาพัง
```

เอกสารอื่น: [branches.md](branches.md) · [deploy.md](deploy.md) · [report_task_port.md](report_task_port.md)
