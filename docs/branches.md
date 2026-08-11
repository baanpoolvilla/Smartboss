# การแบ่ง branch ตามโมดูล

`main` คือตัวจริงที่ deploy ขึ้นเซิร์ฟเวอร์เสมอ — branch อื่นเป็นที่ทำงานระหว่างพัฒนา

## ใครดูแลอะไร

| branch | ไฟล์ที่เป็นเจ้าของ |
|---|---|
| `module/admin` | `apps/web/modules/admin/` · `apps/web/app/(shell)/admin/` · `packages/auth/` |
| `module/hr` | `apps/web/modules/hr/` · `apps/web/app/(shell)/hr/` |
| `module/maintenance` | `apps/web/modules/maintenance/` · `apps/web/app/(shell)/maintenance/` · `apps/web/app/api/files/` |
| `module/report_task` | `apps/web/modules/report_task/` · `apps/web/app/(shell)/report-task/` · `apps/web/app/api/report-task/` |
| `module/workforce` | `apps/workforce-*` · `packages/workforce/*` · `attendance/ESP/` |
| `infra/deploy` | `deploy/` · `docs/deploy.md` · `docker-compose.yml` · `.github/` |

## ⚠ ของกลางที่ทุก branch แตะได้ — แต่ไม่ควรแตะจากที่นี่

```
packages/ui/          ปุ่ม การ์ด ตาราง สี (tokens.css)
packages/database/    schema.prisma + migrations
packages/config/      ค่าตั้งร่วม
apps/web/components/  shell, AppScaffold, icons
apps/web/module-registry.ts
```

**แก้ของกลางให้ทำบน `main` แล้วให้ branch อื่น rebase ตาม** ไม่ใช่แก้ในสาขาตัวเอง

เหตุผล: ถ้าสองโมดูลแก้ `schema.prisma` คนละที่แล้วค่อยมา merge กัน จะได้ migration
ที่ทับกันเองซึ่ง Prisma แก้ให้ไม่ได้ — ต้องมานั่งไล่เขียนใหม่ทั้งคู่

ไอคอนก็เจอมาแล้ว: เพิ่มเมนูใหม่ในโมดูลแต่ลืมลงทะเบียนไอคอนใน
`apps/web/lib/icons.ts` (ของกลาง) เมนูจะขึ้นไอคอน fallback เงียบ ๆ

## วิธีทำงาน

```bash
# เริ่มงานใหม่ — ดึง main ล่าสุดมาก่อนเสมอ
git checkout module/maintenance
git fetch origin
git rebase origin/main

# ...แก้โค้ด...

git push --force-with-lease      # หลัง rebase ต้องใช้ --force-with-lease
```

เอากลับเข้า `main` ผ่าน Pull Request บน GitHub — ก่อน merge ต้องผ่าน:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## rebase ให้บ่อย

branch ที่ทิ้งไว้นานเป็นเดือนจะ merge ยากขึ้นเรื่อย ๆ เพราะของกลางขยับไปแล้ว
**อย่างน้อยสัปดาห์ละครั้ง** หรือทุกครั้งที่ `main` มีของกลางเปลี่ยน

> โมโนรีโปไม่ได้ถูกออกแบบมาให้แยก branch ยาว ๆ — ข้อดีของมันคือแก้ข้ามโมดูล
> ในคอมมิตเดียวได้ ถ้าแยกนานเกินไปจะเสียข้อดีนั้นไปแล้วได้ merge conflict แทน
> ใช้ branch เป็น "ที่ทำงานชั่วคราวของงานหนึ่งชิ้น" แล้วรีบ merge จะได้ประโยชน์สุด

## `module/report_task` ต่างจากคนอื่น

UI ทั้งหมดมาจาก repo [easyboss-workspace](https://github.com/baanpoolvilla/easyboss-workspace)
**ห้ามแก้ UI ที่นี่** — แก้ที่ต้นทางแล้วดึงมาทับตาม [`docs/report_task_port.md`](report_task_port.md)

ที่นี่เป็นเจ้าของแค่ 3 อย่าง: การผูกเข้า shell · ธีม · **ชั้นข้อมูล**

## deploy

เซิร์ฟเวอร์ดึงจาก `main` เท่านั้น (`deploy/release.sh` รัน `git pull` บน `main`)
ของที่ยังอยู่ใน branch จึงยังไม่มีผลกับ `app.easyboss.app`
