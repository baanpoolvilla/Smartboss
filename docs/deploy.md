# คู่มือขึ้นระบบจริง — Google Compute Engine (VM เดียว)

เขียนสำหรับสถานะ ณ 2026-08-08: ยังไม่มีอะไรออนไลน์ ทุกอย่างรันบนเครื่อง dev เท่านั้น

อ่าน [หัวข้อ 0](#0-ภาพรวม) ให้จบก่อนลงมือ แล้วทำไล่ 1 → 11 ตามลำดับ ห้ามข้าม
ทุกหัวข้อมี "ตรวจว่าผ่านแล้ว" ปิดท้าย — ไม่ผ่านให้หยุดแก้ตรงนั้น อย่าไปต่อ

> **สิ่งที่ผมทดสอบจริงแล้ว**: คำสั่ง build (`pnpm turbo run build` ผ่าน 10/10),
> ลำดับตั้งฐานข้อมูล, และไวยากรณ์ของสคริปต์ทุกไฟล์ใน `deploy/`
> **สิ่งที่ยังไม่ได้ทดสอบ**: ขั้นตอนฝั่ง Google Cloud และการรันบน Ubuntu/Debian จริง
> เพราะเครื่อง dev ไม่มี Docker และไม่มี VM ให้ลอง — เจออะไรไม่ตรงบอกได้ครับ

---

## 0. ภาพรวม

### อะไรรันตรงไหน

VM ตัวเดียวรันครบทุกอย่าง แบ่งเป็นสองกลุ่ม

| กลุ่ม | อะไรบ้าง | รันด้วย |
|---|---|---|
| ของสำเร็จรูป | Postgres 18 · Redis 8 · MinIO (ที่เก็บไฟล์) · Caddy (HTTPS) | Docker Compose |
| โค้ดของเรา | web · workforce-api · worker · device-gateway | systemd |

ทำไมไม่เอาโค้ดเราใส่ Docker ด้วย: เรา build จาก source บนเครื่องเดียวกันอยู่แล้ว
การห่อ Docker อีกชั้นเพิ่มแต่ของให้ debug ตอนพัง ส่วน Postgres/Redis/MinIO/Caddy
เป็นของสำเร็จรูปที่ Docker ทำให้ติดตั้งและอัปเกรดง่ายกว่าลงเองมาก

### ใครเปิดสู่อินเทอร์เน็ตบ้าง

```
                       อินเทอร์เน็ต
                            │
                   ┌────────┴────────┐  พอร์ต 80/443 เท่านั้น
                   │      Caddy      │  (ขอใบรับรอง Let's Encrypt เอง)
                   └────────┬────────┘
        ┌──────────────┬────┴─────────┬──────────────┐
        ▼              ▼              ▼              │
  app.<โดเมน>    device.<โดเมน>   files.<โดเมน>       │
        │              │              │              │
        ▼              ▼              ▼              │
   web :3000     gateway :3200    MinIO :9000        │
        │              │                             │
        │              └──────────┐                  │
        ▼                         ▼                  │
   ┌─────────────────────────────────────┐           │
   │  workforce-api :4100  (127.0.0.1)   │◄──────────┘
   │  worker (ไม่มีพอร์ต)                 │
   └──────────────┬──────────────────────┘
                  ▼
        Postgres :5432 · Redis :6379   (127.0.0.1 ทั้งคู่)
```

**ข้อได้เปรียบของ VM เดียวเทียบกับแผนเดิม (Vercel + Railway)**: ตอนนั้นเว็บอยู่คนละที่
กับ API จึงต้องเปิด API ซึ่งมีข้อมูลเงินเดือนทั้งหมดสู่อินเทอร์เน็ต ตอนนี้เว็บเรียก API
ผ่าน `127.0.0.1` ⇒ **API ไม่ต้องมีทางเข้าจากข้างนอกเลย** ตรงกับเจตนาเดิมของสถาปัตยกรรม

### ของที่ต้องมีก่อนเริ่ม

- [ ] บัญชี Google Cloud ที่เปิด billing แล้ว
- [ ] โดเมนที่แก้ DNS ได้ — ใช้ 3 ชื่อย่อย เช่น `app.` `device.` `files.`
- [ ] เครื่องคุณมี `gcloud` (หรือใช้ Cloud Shell บนเว็บก็ได้ ไม่ต้องลงอะไร)
- [ ] เวลาว่างต่อเนื่องราว 2 ชั่วโมงสำหรับรอบแรก

**ยังไม่ต้องมี**: Neon, Railway, Vercel, Upstash, Cloudflare R2 — VM ตัวเดียวแทนได้หมด

### ค่าใช้จ่ายคร่าว ๆ

`e2-medium` + ดิสก์ 50 GB + IP นิ่ง ที่ Singapore ตกราวหลักพันบาทต้น ๆ ต่อเดือน
เช็คตัวเลขจริงที่ [Pricing Calculator](https://cloud.google.com/products/calculator)
ก่อนกดสร้าง เพราะราคาเปลี่ยนได้ · ประหยัดได้อีกด้วย committed use discount เมื่อแน่ใจแล้ว

---

## 1. สร้าง VM

### เลือกสเปก

| ช่อง | ค่า | เหตุผล |
|---|---|---|
| Region | `asia-southeast1` (สิงคโปร์) | ใกล้ไทยที่สุด หน่วงต่ำสุด |
| Machine type | `e2-medium` (2 vCPU / 4 GB) | **ต่ำกว่านี้ `next build` จะโดน OOM kill** |
| Boot disk | Ubuntu 24.04 LTS (หรือ Debian 12), 50 GB, balanced | 50 GB เผื่อไฟล์แนบและ backup |
| Firewall | ติ๊ก allow HTTP + HTTPS | |

`e2-small` (2 GB) ใช้ได้ถ้าเพิ่ม swap ตามข้อ 3 แต่ build จะช้ามาก แนะนำ `e2-medium`

### สร้างด้วย gcloud

```bash
gcloud compute instances create smartboss \
  --zone=asia-southeast1-b \
  --machine-type=e2-medium \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=50GB --boot-disk-type=pd-balanced \
  --tags=http-server,https-server \
  --metadata=enable-oslogin=TRUE
```

### จอง IP ให้นิ่ง

IP ที่แถมมากับ VM เป็น ephemeral — **รีสตาร์ตเครื่องแล้วเปลี่ยน** ซึ่งแปลว่า DNS พังและ
ใบรับรอง HTTPS ต่ออายุไม่ได้ ต้องจองเป็น static ก่อนตั้ง DNS

```bash
gcloud compute addresses create smartboss-ip --region=asia-southeast1

# ถอด IP เดิมออกแล้วใส่ตัวที่จองไว้
gcloud compute instances delete-access-config smartboss \
  --zone=asia-southeast1-b --access-config-name="external-nat"
gcloud compute instances add-access-config smartboss \
  --zone=asia-southeast1-b --access-config-name="external-nat" \
  --address=$(gcloud compute addresses describe smartboss-ip \
              --region=asia-southeast1 --format='value(address)')

# จดเลขนี้ไว้ ใช้ตอนตั้ง DNS
gcloud compute addresses describe smartboss-ip \
  --region=asia-southeast1 --format='value(address)'
```

### ตรวจว่าผ่านแล้ว

```bash
gcloud compute ssh smartboss --zone=asia-southeast1-b
```
เข้าเครื่องได้ = ผ่าน

---

## 2. ตั้ง DNS

ที่ผู้ให้บริการโดเมน สร้าง **A record 3 ตัว** ชี้ไป IP ที่จองไว้

| ชื่อ | ชนิด | ค่า |
|---|---|---|
| `app` | A | `<IP ของ VM>` |
| `device` | A | `<IP ของ VM>` |
| `files` | A | `<IP ของ VM>` |

### ตรวจว่าผ่านแล้ว — ข้อนี้ห้ามข้าม

```bash
dig +short app.<โดเมน> device.<โดเมน> files.<โดเมน>
```

ต้องได้ IP ของ VM **ครบทั้ง 3 ชื่อ** ก่อนไปข้อ 7

> ⚠ ถ้าเริ่ม Caddy ตอน DNS ยังไม่ชี้มา มันจะขอใบรับรองไม่สำเร็จซ้ำ ๆ จนโดน
> rate limit ของ Let's Encrypt (ล้มเหลว 5 ครั้ง/ชม./โดเมน) แล้วต้องรอเป็นชั่วโมง

DNS ใช้เวลากระจาย 5 นาที – 24 ชม. แล้วแต่ TTL เดิม รอให้ `dig` ตอบถูกก่อนค่อยไปต่อ

> **ถ้าใช้โดเมน `.app` / `.dev`**: TLD กลุ่มนี้อยู่ในรายการ HSTS preload ของเบราว์เซอร์
> ⇒ เบราว์เซอร์ **บังคับ https เสมอ** เปิดผ่าน http ไม่ได้เลยแม้แต่ครั้งแรก
> — ไม่กระทบการขอใบรับรอง (Let's Encrypt ตรวจจากฝั่งเซิร์ฟเวอร์ ไม่ใช่เบราว์เซอร์)
> แต่แปลว่าตอนไล่หาปัญหา อย่าเสียเวลาลอง `curl http://...` ให้ทดสอบด้วย https ตรง ๆ

---

## 3. ตั้งเครื่อง

SSH เข้าไปแล้วรันทีละบล็อก

```bash
# ── เวลา ──
# ตั้งเป็นเวลาไทยตั้งแต่ต้น เพราะ cron, log และรอบเงินเดือนอิงเวลาท้องถิ่นทั้งหมด
sudo timedatectl set-timezone Asia/Bangkok

# ── swap 2 GB ──
# ประกันการ build ไม่ให้โดน OOM kill ตอน next build ใช้แรมพีค
# บน e2-medium มักไม่ได้ใช้ แต่มีไว้ราคาถูกกว่าตามหาเหตุ build ล้มแบบไม่มี error
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# ── ของพื้นฐาน ──
sudo apt-get update
sudo apt-get install -y git curl ca-certificates gnupg postgresql-client

# ── Node 22 LTS ──
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm@11.13.1

# ── Docker ──
sudo install -m 0755 -d /etc/apt/keyrings
# $ID = debian หรือ ubuntu — อ่านจากเครื่องเอง ไม่ต้องแก้ตามภาพที่เลือก
# ⚠ ถ้าเขียนตายเป็น debian แล้วเครื่องเป็น Ubuntu จะได้ 404 ตอน apt-get update
# เพราะ repo ของ Docker แยกกันคนละ path และ codename ก็คนละชุด
DOCKER_OS=$(. /etc/os-release && echo "$ID")
DOCKER_CODENAME=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")

curl -fsSL "https://download.docker.com/linux/$DOCKER_OS/gpg" \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/$DOCKER_OS $DOCKER_CODENAME stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# ── ผู้ใช้สำหรับรันแอป ──
# ไม่รันด้วย root และไม่รันด้วยบัญชี SSH ของคุณ — โดนเจาะแล้วจำกัดความเสียหายได้
sudo useradd --system --create-home --home-dir /home/smartboss --shell /bin/bash smartboss
sudo usermod -aG docker smartboss
sudo install -d -o smartboss -g smartboss /opt/smartboss
sudo install -d -o smartboss -g smartboss -m 700 /var/backups/smartboss
```

### ตรวจว่าผ่านแล้ว

```bash
node -v          # v22.x
pnpm -v          # 11.13.0
docker --version
free -h | grep -i swap    # ต้องเห็น 2.0Gi
timedatectl | grep "Time zone"   # Asia/Bangkok
```

---

## 4. เอาโค้ดขึ้นเครื่อง

```bash
sudo -u smartboss git clone <URL ของ repo> /opt/smartboss
cd /opt/smartboss
```

> repo นี้ยังไม่ได้ commit เลยสักครั้ง (`git status` มีแต่ไฟล์ untracked)
> ถ้ายังไม่มี remote ให้สร้าง repo ส่วนตัวบน GitHub แล้ว push ขึ้นไปก่อน
> — อย่าใช้ repo สาธารณะ เพราะจะมีคนอ่านโครงสิทธิ์และตรรกะ auth ทั้งหมด

---

## 5. สร้างความลับและไฟล์ตั้งค่า

```bash
cd /opt/smartboss
sudo bash deploy/init-env.sh   --domain <โดเมนคุณ>   --email  <อีเมลคุณ>   --org    "<ชื่อบริษัทของคุณ>"
```

สคริปต์จะสุ่มความลับทั้งหมดแล้วเขียนไฟล์ให้ครบสองไฟล์พร้อมสิทธิ์ที่ถูกต้อง

| ไฟล์ | ใครอ่าน | สิทธิ์ |
|---|---|---|
| `/etc/smartboss/` | โฟลเดอร์ — ต้องให้กลุ่มเดินผ่านได้ | `root:smartboss 750` |
| `/etc/smartboss/smartboss.env` | systemd (ทั้ง 4 บริการ) + สคริปต์ใน `deploy/` | `root:smartboss 640` |
| `/opt/smartboss/deploy/.env` | docker compose | `smartboss 600` |

**ทำไมไม่ให้กรอกมือ**: ค่ามี 30 กว่าตัว และมีคู่ที่ต้องตรงกันเป๊ะ —
`JWT_SECRET` = `AUTH_SMARTBOSS_SECRET` · รหัส Postgres ต้องไปโผล่ใน `DATABASE_URL`
ด้วย · คีย์ MinIO ใช้ทั้งชื่อ `S3_*` และ `STORAGE_*` พิมพ์เองพลาดง่ายมาก
และอาการเวลาพลาดคือ "login ได้แต่ทุกหน้า HR ขึ้น 401" ซึ่งไล่หาสาเหตุยาก

รหัสผ่านของบัญชีผู้ดูแลจะถูกพิมพ์ออกมาครั้งเดียวตอนจบ — **จดไว้**

> สคริปต์จะหยุดทันทีถ้าไฟล์มีอยู่แล้ว กันเผลอสร้างความลับชุดใหม่ทับของเดิม
> ซึ่งจะทำให้ข้อมูลที่เข้ารหัสไว้อ่านไม่ออกตลอดกาล

### สำรองความลับออกนอกเครื่อง — ทำเดี๋ยวนี้

`FIELD_ENCRYPTION_KEY` หายเมื่อไหร่ เลขบัตรประชาชนและเลขบัญชีธนาคารที่เข้ารหัสไว้
**กู้ไม่ได้เลย ไม่มีทางลัด** ก๊อปไปเก็บใน password manager ตอนนี้ อย่ารอ

```bash
sudo grep FIELD_ENCRYPTION_KEY /etc/smartboss/smartboss.env
```

---

## 6. เปิดของสำเร็จรูป

```bash
cd /opt/smartboss
sudo -u smartboss docker compose -f deploy/docker-compose.yml up -d postgres redis minio
sudo -u smartboss docker compose -f deploy/docker-compose.yml ps
```

รอจน `postgres` และ `minio` ขึ้น `healthy` (ราว 30 วินาที) แล้วสร้างถังเก็บไฟล์

```bash
sudo bash deploy/init-storage.sh
```

สคริปต์รอจน MinIO พร้อม สร้างถัง แล้ว **ปิดการเข้าถึงแบบไม่ล็อกอิน** ให้ชัดเจน —
ทุกไฟล์ต้องมาพร้อม presigned URL ที่เว็บเซ็นให้ อายุ 5 นาที
ถ้าเผลอเปิดสาธารณะ ใครเดา key ถูกก็โหลดสลิปเงินเดือนได้

> ⚠ อย่าเขียนเป็น `docker run ... mc -c 'mc alias set ... "$MINIO_ROOT_USER" ...'`
> ตัวแปรในสตริงนั้นจะถูกขยาย **ข้างในคอนเทนเนอร์** ซึ่งไม่มีค่า กลายเป็นล็อกอิน
> ด้วยชื่อว่าง แล้วขึ้น error ที่อ่านแล้วไม่รู้สาเหตุ — สคริปต์ส่งผ่าน
> `MC_HOST_local` จากฝั่งโฮสต์แทน

> ยังไม่ต้องเปิด `caddy` ตอนนี้ — รอถึงข้อ 8 เพราะยังไม่มีอะไรให้มันชี้ไป

### ตรวจว่าผ่านแล้ว

```bash
docker compose -f deploy/docker-compose.yml ps   # postgres/redis/minio = healthy
psql "postgresql://smartboss:<รหัส>@127.0.0.1:5432/smartboss" -c 'select version()'
```

---

## 7. ตั้งฐานข้อมูล

```bash
cd /opt/smartboss
sudo -u smartboss pnpm install --frozen-lockfile
sudo -u smartboss ENV_FILE=/etc/smartboss/smartboss.env bash deploy/bootstrap-db.sh
```

สคริปต์นี้ทำ 5 ขั้นตามลำดับที่ถูกต้อง **ลำดับสำคัญมาก** จึงห่อไว้ในสคริปต์แทนที่จะ
ให้พิมพ์เอง:

| ขั้น | ทำอะไร | ข้ามแล้วเกิดอะไร |
|---|---|---|
| 1 | build `@workforce/db` และสายที่มันพึ่ง | `wf:migrate` ตายด้วย `MODULE_NOT_FOUND` — `@workforce/config` ชี้ main ไป `dist/` ที่ถูก gitignore ไว้ เครื่องที่ clone ใหม่จึงยังไม่มี |
| 2 | `00-create-role.sql` | RLS ไม่มีผล = บริษัทเห็นข้อมูลกันได้ |
| 3 | `db:deploy` + `wf:migrate` | ไม่มีตาราง |
| 4 | `01-grant-app-role.sql` | แอปอ่านตาราง workforce ไม่ได้ |
| 4 | `02-lookup-functions-owner.sql` | **เครื่องสแกน activate ไม่ได้** ขึ้น 401 ทั้งที่ token ถูก |
| 4 | `04-performance-lookup.sql` | **หน้าสรุปผลงานไม่แสดงมาสาย/ขาดงานเลย ตลอดกาล โดยไม่มี error** |
| 5 | `db:seed` + `wf:sync` | ไม่มีผู้ใช้ให้ login |
| 6 | `03-verify.sql` | ไม่รู้ว่าพัง |

`01` และ `02` ต้องรัน **หลัง** `wf:migrate` เสมอ เพราะอ้างถึง schema `workforce`
ที่ migration เป็นคนสร้าง

### ตรวจว่าผ่านแล้ว

อ่านผลของ `03-verify.sql`:
- ทุกช่อง `verdict` = `ok`
- ข้อ 5 ไม่มีแถว
- ข้อ 6 ได้ `0` ทั้งสองช่อง

> ⚠ **ข้อ 6 ไม่ใช่ 0 แปลว่าการแยกข้อมูลระหว่างบริษัทพัง — หยุด อย่าเปิดใช้งาน**

---

## 8. build แล้วเปิดบริการ

```bash
cd /opt/smartboss
sudo -u smartboss pnpm turbo run build
```

ใช้เวลาราว 5–10 นาทีบน `e2-medium` ถ้าค้างแล้วเครื่องหายไปเฉย ๆ คือ OOM — เพิ่ม swap
หรือขยายเครื่อง

ติดตั้ง systemd unit ทั้ง 4 ตัว

```bash
sudo cp /opt/smartboss/deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now smartboss-api smartboss-worker smartboss-gateway smartboss-web
sudo systemctl status smartboss-* --no-pager
```

ให้ smartboss รีสตาร์ตบริการเองได้ (สคริปต์ `release.sh` ใช้) — **ข้ามไม่ได้**

```bash
sudo install -m 440 -o root -g root   /opt/smartboss/deploy/sudoers.d-smartboss /etc/sudoers.d/smartboss
sudo visudo -c
```

ใช้ไฟล์ในโปรเจกต์แทนการพิมพ์เอง เพราะบรรทัดในนั้นต้องตรงกับคำสั่งใน `release.sh`
**เป๊ะ รวมลำดับชื่อบริการ** — sudoers เทียบแบบตรงตัว

ข้ามขั้นนี้แล้ว `release.sh` จะไปค้างที่ช่องถามรหัสผ่านที่ตอบไม่ได้
(`smartboss` เป็น system user ไม่มีรหัสผ่าน) — ตอนนี้สคริปต์ล้มทันทีพร้อมบอกวิธีแก้แล้ว

เปิด HTTPS

```bash
cd /opt/smartboss
sudo -u smartboss docker compose -f deploy/docker-compose.yml up -d caddy
sudo -u smartboss docker compose -f deploy/docker-compose.yml logs -f caddy
```

ดู log จนเห็นว่าออกใบรับรองครบ 3 โดเมน (คำว่า `certificate obtained successfully`)
แล้วกด Ctrl-C

### ตรวจว่าผ่านแล้ว

```bash
curl -sI https://app.<โดเมน>/login | head -1                          # HTTP/2 200

# API ตอบ — health เป็น public endpoint ไม่ต้องมี token
curl -s http://127.0.0.1:4100/api/workforce/v1/health
# {"status":"ok","service":"workforce-api","time":"..."}

# health/ready ตรวจฐานข้อมูลและ migration ให้ด้วย — ใช้ตัวนี้บอกว่า "พร้อมรับงานจริง"
curl -s http://127.0.0.1:4100/api/workforce/v1/health/ready

sudo journalctl -u smartboss-api -n 30 --no-pager   # ไม่มี error ซ้ำ ๆ
```

---

## 9. ตรวจทั้งระบบ

ทำตามลำดับ หยุดทันทีที่ข้อไหนไม่ผ่าน

**9.1 เข้าเว็บได้** — เปิด `https://app.<โดเมน>` login ด้วย `SEED_ADMIN_EMAIL`
กับ `SEED_ADMIN_PASSWORD` → **เปลี่ยนรหัสผ่านทันที** แล้วลบบรรทัด `SEED_*` ทั้งหมด
ออกจาก `/etc/smartboss/smartboss.env`

> seed สร้างให้แค่ **บริษัทเดียวกับผู้ดูแลระบบสูงสุดคนเดียว** ไม่มีผู้ใช้ตัวอย่าง
> และไม่มีข้อมูลทดสอบใด ๆ — พนักงานจริงเพิ่มเองที่ `/admin/users`
>
> ⚠ SUPER_ADMIN ถูกกันไม่ให้เห็นข้อมูลเงินเดือนรายบุคคลโดยตั้งใจ ตอนจะทำเงินเดือน
> ต้องเพิ่มผู้ใช้ที่ถือบทบาท `HR_OFFICER` ก่อน

**9.2 API รับ token ของเว็บ** — เข้า `/hr/employees` ต้องเห็นรายการ ไม่ใช่ 401
> 401 = `JWT_SECRET` กับ `AUTH_SMARTBOSS_SECRET` ไม่ตรงกัน กลับไปข้อ 5

**9.3 อัปโหลดไฟล์ได้จริง** — สร้างใบแจ้งซ่อมแล้วแนบรูป จากนั้น **เปิดจากมือถือ
ที่ไม่ได้ต่อเน็ตเดียวกัน** ถ้ารูปไม่ขึ้น = `S3_ENDPOINT` ยังชี้ `127.0.0.1`

**9.4 gateway ปล่อยเฉพาะ path ของเครื่องสแกน**
```bash
curl -so /dev/null -w '%{http_code}\n' https://device.<โดเมน>/api/workforce/v1/employees
# ต้องได้ 404

curl -so /dev/null -w '%{http_code}\n' -X POST https://device.<โดเมน>/api/workforce/v1/device-activation
# ต้องไม่ใช่ 404 (400/401 ถือว่าถูก — แปลว่าผ่านด่านเข้าไปถึง API แล้ว)
```

**9.5 โปรโตคอลเครื่องสแกนครบวงจร** — จำลองเครื่องด้วย Ed25519 จริง ไม่ต้องมีฮาร์ดแวร์
```bash
SMARTBOSS_URL=https://app.<โดเมน> \
WORKFORCE_URL=https://device.<โดเมน> \
VERIFY_EMAIL=<อีเมลแอดมิน> VERIFY_PASSWORD=<รหัสผ่าน> \
  node scripts/verify-device-protocol.mjs
```
ต้องเดินครบ 6 ขั้นจนสถานะ `ACTIVE` และการส่งซ้ำต้องได้ **409**

**9.6 การแยกข้อมูลระหว่างบริษัท** — สร้างบริษัทที่สองที่ `/admin` เพิ่มผู้ใช้เข้าไป
แล้ว login ด้วยผู้ใช้นั้น ต้องไม่เห็นข้อมูลของบริษัทแรกเลยสักหน้า

**ผ่าน 9.5 แล้วค่อย flash ESP32** — ก่อนหน้านั้น flash ไปก็ผูกเครื่องไม่ได้

---

## 10. cron และ backup

### cron ประจำวัน

แผนเดิมใช้ cron ของ Vercel ซึ่งไม่มีแล้วบน VM ใช้ crontab ของเครื่องแทน

```bash
sudo crontab -e
```

```cron
# งานประจำวันของโมดูลซ่อมบำรุง + คะแนนผลงาน — 08:00 เวลาไทย
0 8 * * * bash /opt/smartboss/deploy/cron-run.sh all >> /var/log/smartboss-cron.log 2>&1

# กวาดคะแนนผลงานอีกรอบตอนเย็น ให้ผู้บริหารเห็นของวันนี้ก่อนเลิกงาน
0 17 * * * bash /opt/smartboss/deploy/cron-run.sh performance >> /var/log/smartboss-cron.log 2>&1

# สำรองฐานข้อมูล 02:30 ทุกคืน
30 2 * * * bash /opt/smartboss/deploy/backup.sh >> /var/log/smartboss-backup.log 2>&1
```

ทดสอบเลยโดยไม่ต้องรอพรุ่งนี้

```bash
sudo bash /opt/smartboss/deploy/cron-run.sh all
```

ต้องได้ JSON ที่ขึ้นต้น `{"ok":true` — ถ้าได้ 401 แปลว่า `CRON_SECRET` ไม่ตรง

> รันซ้ำได้ไม่มีผลเสีย: การหักคะแนนกันซ้ำด้วย unique key ของต้นเรื่อง
> และการสร้างใบงานจาก PM เช็ครอบก่อนสร้าง

### backup ที่เชื่อถือได้

**backup ที่อยู่บนเครื่องเดียวกับฐานข้อมูล ไม่ใช่ backup** — VM หายไปก็หายด้วยกัน
ทำอย่างน้อยหนึ่งอย่าง (ทำทั้งสองยิ่งดี)

**ก. ส่ง dump ขึ้น Cloud Storage**
```bash
gcloud storage buckets create gs://<ชื่อ>-smartboss-backup --location=asia-southeast1
echo 'BACKUP_BUCKET=<ชื่อ>-smartboss-backup' | sudo tee -a /etc/smartboss/smartboss.env
sudo bash /opt/smartboss/deploy/backup.sh     # ลองเลย
```
VM ต้องมีสิทธิ์เขียน bucket — ให้ service account ของ VM มี role
`roles/storage.objectCreator` บน bucket นั้น

**ข. snapshot ดิสก์อัตโนมัติ**
```bash
gcloud compute resource-policies create snapshot-schedule smartboss-daily \
  --region=asia-southeast1 --max-retention-days=30 \
  --daily-schedule --start-time=19:00 --storage-location=asia-southeast1
gcloud compute disks add-resource-policies smartboss \
  --zone=asia-southeast1-b --resource-policies=smartboss-daily
```
(19:00 UTC = 02:00 เวลาไทย)

### ซ้อมกู้ — ข้อนี้คนข้ามกันมากที่สุด

backup ที่ไม่เคยลองกู้ ยังไม่นับว่ามี ลองสักครั้งตอนที่ยังไม่มีข้อมูลลูกค้า

```bash
docker compose -f /opt/smartboss/deploy/docker-compose.yml exec -T postgres \
  createdb -U smartboss smartboss_restore_test
docker compose -f /opt/smartboss/deploy/docker-compose.yml exec -T postgres \
  pg_restore -U smartboss -d smartboss_restore_test < /var/backups/smartboss/<ไฟล์ล่าสุด>.dump
# ตรวจแล้วลบทิ้ง
docker compose -f /opt/smartboss/deploy/docker-compose.yml exec -T postgres \
  dropdb -U smartboss smartboss_restore_test
```

---

## 10.5 รับลูกค้ารายใหม่

ทำจากหน้าเว็บทั้งหมด **ไม่ต้อง ssh เข้าเซิร์ฟเวอร์**

1. login ด้วยบัญชี SUPER_ADMIN
2. ไปที่ **หลังบ้าน → บริษัททั้งหมด → เปิดบริษัทใหม่**
3. กรอกชื่อบริษัท รหัสบริษัท แพ็กเกจ และผู้ดูแลคนแรก (ชื่อ/อีเมล/รหัสผ่าน)

ระบบสร้างให้ครบชุดในครั้งเดียว: บทบาท 10 ตัวพร้อมสิทธิ์ตั้งต้น · เปิด 3 โมดูล ·
พื้นที่ข้อมูลฝั่ง workforce (tenant) · บัญชีผู้ดูแลคนแรก

ส่งอีเมลกับรหัสผ่านให้ลูกค้า แล้วเขาเพิ่มพนักงานเองได้ที่หน้าผู้ใช้งานของบริษัทตัวเอง

> เมนู "บริษัททั้งหมด" มองเห็นได้เฉพาะ SUPER_ADMIN เพราะสิทธิ์ `core.org.create`
> ไม่ได้ถูกมอบให้บทบาทใดเลย — แอดมินของลูกค้าจึงเปิดบริษัทใหม่ในระบบเราไม่ได้

**ถ้าเห็นป้าย "โมดูลบุคคลยังไม่พร้อม"** แปลว่าบริษัทนั้นยังไม่มี tenant ฝั่ง workforce
(เช่นตอนสร้างมีปัญหาชั่วคราว หรือเป็นบริษัทที่มาจาก `db:seed` ก่อนรัน `wf:sync`)
กดปุ่ม **"เปิดโมดูลบุคคล"** ที่รายการนั้น — กดซ้ำได้ ไม่สร้างข้อมูลซ้ำ

ปล่อยไว้ไม่ได้: หน้าจอในโมดูลบุคคลของบริษัทนั้นจะ **ว่างเปล่าโดยไม่มีข้อความแจ้ง**
เพราะ RLS กรองข้อมูลทิ้งเมื่อไม่มี tenant ตรงกัน

---

## 11. อัปเดตเวอร์ชันใหม่

```bash
cd /opt/smartboss
sudo -u smartboss bash deploy/release.sh
```

สคริปต์จะ `git pull` → `pnpm install` → เช็ค migration ค้าง → `build` → รีสตาร์ต →
รอจนเว็บตอบ ถ้ามี migration ใหม่จะ **หยุดแล้วบอกให้ลงเอง** โดยตั้งใจ
เพราะการเปลี่ยนโครงฐานข้อมูลควรเป็นการตัดสินใจของคน ไม่ใช่ผลข้างเคียงของ deploy

```bash
# ลง migration ใหม่ (ทำตอนมีเวลาดูผล ไม่ใช่ตอนรีบ)
sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; pnpm db:deploy && pnpm wf:migrate'
```

**ย้อนกลับเวอร์ชัน**
```bash
cd /opt/smartboss
sudo -u smartboss git checkout <commit เดิม>
sudo -u smartboss bash deploy/release.sh --no-pull
```
> migration ย้อนไม่ได้ด้วยวิธีนี้ — ถ้าเวอร์ชันใหม่มี migration ต้องกู้จาก backup แทน
> เอา backup ก่อน deploy ที่มี migration เสมอ

---

## 11.5 เข้าฐานข้อมูล

Postgres ผูกกับ `127.0.0.1` เท่านั้น **ต่อจากข้างนอกไม่ได้โดยตั้งใจ** — ต้อง ssh เข้าไปก่อน

### วิธีที่ 1 — psql บน VM (เร็วสุด)

```bash
gcloud compute ssh smartboss-prod --zone=asia-southeast1-c
sudo bash /opt/smartboss/deploy/psql.sh
```

สคริปต์อ่านรหัสผ่านจาก `/etc/smartboss/smartboss.env` ให้เอง — ไม่ต้องพิมพ์รหัสลงใน
คำสั่ง ซึ่งจะไปค้างอยู่ใน `~/.bash_history` แบบไม่เข้ารหัส

```bash
# รันคำสั่งเดียวแล้วออก
sudo bash /opt/smartboss/deploy/psql.sh -c "select slug, name from core.organizations;"
```

### วิธีที่ 2 — Prisma Studio (มีหน้าจอให้คลิก)

บน VM:
```bash
cd /opt/smartboss
sudo -u smartboss bash -c 'set -a; . /etc/smartboss/smartboss.env; set +a; pnpm db:studio'
```

บนเครื่องคุณ เปิดอุโมงค์มาที่พอร์ต 5555:
```bash
gcloud compute ssh smartboss-prod --zone=asia-southeast1-c -- -N -L 5555:127.0.0.1:5555
```
แล้วเปิด http://localhost:5555

> Prisma Studio เห็นเฉพาะตารางใน `core` / `maintenance` / `report_task`
> ตาราง `workforce` ใช้ Drizzle จึงไม่อยู่ในนั้น

### วิธีที่ 3 — ต่อด้วย DBeaver / pgAdmin ผ่านอุโมงค์

```bash
gcloud compute ssh smartboss-prod --zone=asia-southeast1-c -- -N -L 5432:127.0.0.1:5432
```
แล้วตั้งค่าโปรแกรมเป็น `localhost:5432` · user `smartboss` · รหัสจาก
`sudo grep POSTGRES_PASSWORD /opt/smartboss/deploy/.env`

### ⚠ กับดัก: ตาราง workforce จะว่างเปล่าเสมอ

```sql
SELECT count(*) FROM workforce.employments;   -- ได้ 0 ทั้งที่มีข้อมูล
```

ไม่ใช่ไม่มีข้อมูล — ตารางฝั่ง workforce เปิด **FORCE ROW LEVEL SECURITY** ซึ่งบังคับ
กับเจ้าของตารางด้วย ถ้าไม่บอกว่าดูบริษัทไหน จะถูกกรองทิ้งหมด **โดยไม่มี error**

ต้องตั้ง tenant context ก่อน:

```sql
BEGIN;
SET LOCAL ROLE workforce_app;
SELECT set_config('workforce.tenant_id',
  (SELECT id::text FROM core.organizations WHERE slug = 'main'), true);

SELECT count(*) FROM workforce.employments;   -- คราวนี้เห็นจริง

ROLLBACK;   -- อ่านอย่างเดียวก็ ROLLBACK ไปเลย ปลอดภัยกว่า
```

### ⚠ ก่อนแก้ข้อมูลตรง ๆ

**สำรองก่อนเสมอ** — `sudo bash /opt/smartboss/deploy/backup.sh`

การ `UPDATE`/`DELETE` ที่ psql ข้ามตรรกะของแอปทั้งหมด: ไม่มี audit log,
ไม่มีการตรวจสิทธิ์, ไม่อัปเดต `version` ที่ใช้กันสองแท็บเขียนทับกัน
และไม่ส่งเหตุการณ์คะแนนผลงาน — ใช้เท่าที่จำเป็นจริง ๆ

---

## 12. เจอปัญหาแล้วดูตรงไหน

```bash
sudo journalctl -u smartboss-web -n 100 --no-pager     # เว็บ
sudo journalctl -u smartboss-api -n 100 --no-pager     # API
sudo journalctl -u smartboss-worker -f                 # worker แบบสด
docker compose -f /opt/smartboss/deploy/docker-compose.yml logs --tail=100 caddy
```

| อาการ | สาเหตุที่พบบ่อยที่สุด |
|---|---|
| ทุกหน้า HR ขึ้น 401 | `JWT_SECRET` ≠ `AUTH_SMARTBOSS_SECRET` |
| หน้า HR ขึ้น 500 / ต่อ API ไม่ได้ | `WORKFORCE_API_BASE` ไม่มี `/api/workforce/v1` ต่อท้าย |
| รูปแนบเปิดไม่ขึ้นจากมือถือ | `S3_ENDPOINT` ยังเป็น `127.0.0.1` |
| `smartboss-api` restart วน | ค่าบังคับใน env ขาด — ดู journalctl จะบอกชื่อตัวแปรตรง ๆ |
| HTTPS ไม่ขึ้น | DNS ยังไม่ชี้มา หรือ firewall ไม่เปิด 80/443 |
| หน้าสรุปผลงานไม่มีมาสาย/ขาดงาน | ข้าม `04-performance-lookup.sql` ตอนข้อ 7 |
| เครื่องสแกน activate ไม่ได้ (401) | ข้าม `02-lookup-functions-owner.sql` ตอนข้อ 7 |
| `next build` ค้างแล้วเครื่องหลุด | แรมไม่พอ — เพิ่ม swap หรือขยายเครื่อง |

---

## 13. โค้ดเครื่องสแกน (ทำหลังข้อ 9 ผ่าน)

ทำตาม `attendance/ESP/attendance_esp32_workforce/README.md` โดยตั้ง

```cpp
#define DEFAULT_SERVER_URL "https://device.<โดเมนคุณ>"   // origin เฉย ๆ ห้ามใส่ /api/workforce/v1
```

แล้วออก activation token จากหน้าเว็บ `/hr/devices`

> ⚠ สเก็ตช์ตัวนี้ **ยังไม่เคยคอมไพล์หรือ flash** เขียนโดยไม่มีบอร์ดและไม่มี Arduino
> toolchain ตัวโปรโตคอลพิสูจน์แล้วด้วยสคริปต์ข้อ 9.5 แต่โค้ดฝั่งบอร์ดยังต้องคอมไพล์จริงก่อน
> ของเดิม `attendance/ESP/attendance_esp32_wifi/` ไม่ถูกแตะ ยังใช้งานได้ตามปกติ

---

## 14. ยังไม่พร้อม — ต้องรู้ก่อนเปิดให้ลูกค้าจ่ายเงิน

| เรื่อง | สถานะ | ผลถ้าเปิดใช้เลย |
|---|---|---|
| อัตราประกันสังคม / ภาษี | **DRAFT** ยังไม่มีผู้เชี่ยวชาญรับรอง | ตัวเลขเงินเดือนใช้อ้างอิงทางกฎหมายไม่ได้ |
| sync template ลายนิ้วมือข้ามเครื่อง | ไม่มี endpoint (spec ห้าม template ออกจากเซนเซอร์) | มีหลายเครื่องต้องสั่ง enroll ทีละเครื่อง |
| หน้าลา/OT, ตารางกะ, แก้เวลาย้อนหลัง | ยังไม่มีหน้าจอ | ต้องทำผ่าน API ตรง |
| สเก็ตช์ ESP32 ตัวใหม่ | ยังไม่คอมไพล์ | ต้องคอมไพล์จริงก่อนใช้ |
| ค่าตั้งรายบริษัทบางตัว | ยังฝังในโค้ด — ดู `docs/settings-audit.md` | ทุกบริษัทถูกบังคับใช้ค่าเดียวกัน |

แนะนำเปิดแบบ **parallel run**: ใช้ระบบเดิมควบคู่ไปอย่างน้อยหนึ่งรอบจ่ายเงินเดือน
แล้วเทียบผลกันก่อนตัดระบบเดิมทิ้ง

---

## ภาคผนวก — ทำไมไม่ใช้ Vercel + Neon อย่างที่วางไว้ตอนแรก

เอกสารรุ่นก่อนหน้าเขียนตามแผน Vercel (เว็บ) + Railway (3 โปรเซส) + Neon (ฐานข้อมูล)
พอย้ายมา VM เดียวของ Google ผลที่ต่างไปคือ

| เรื่อง | แผนเดิม | ตอนนี้ |
|---|---|---|
| workforce-api | ต้องเปิดสู่อินเทอร์เน็ต เพราะเว็บอยู่คนละที่ | อยู่หลัง `127.0.0.1` ไม่มีทางเข้าจากข้างนอก |
| จำนวนบัญชีที่ต้องดูแล | Vercel + Railway + Neon + Upstash + R2 | Google Cloud อย่างเดียว |
| cron | `vercel.json` | crontab ของเครื่อง (ข้อ 10) |
| ที่เก็บไฟล์ | Cloudflare R2 | MinIO บน VM (ย้ายไป R2/GCS ทีหลังได้ แก้แค่ env) |
| ค่าใช้จ่าย | จ่ายหลายเจ้า สเกลตามการใช้ | ก้อนเดียวคงที่ |
| งานที่เพิ่มขึ้น | — | ต้องดูแล backup, อัปเดต OS, ตรวจดิสก์เต็มเอง |

ไฟล์ `docker-compose.yml` ที่รากโปรเจกต์เป็นของ **dev เท่านั้น** (Postgres 16 / Redis 7)
ของ production คือ `deploy/docker-compose.yml`
