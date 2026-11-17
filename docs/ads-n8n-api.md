# Google Ads × n8n — API ของ Smartboss

ตั้งแต่ 17/11/2569 ส่วน AI ของโมดูล Google Ads อยู่บน n8n ทั้งหมด Smartboss ทำ 4 อย่าง:

1. รับข้อมูลโฆษณาที่ n8n ดึงจาก Google Ads
2. คิด KPI / สถานะ / ข้อสังเกต (Rule Engine) ให้ AI อ่าน
3. รับ "คำขอปรับ" จาก AI แล้วส่งการ์ดเข้ากลุ่มแชท **🤖 Ads Agent** (หรือหน้า **Google Ads › คำขอปรับ**) — **สมาชิกกลุ่มทุกคนกดอนุมัติได้ กดได้ครั้งเดียว คนแรกชนะ**
4. บอก n8n ว่าคำขอไหนอนุมัติแล้ว และรับผลการยิงกลับมาแสดง

Smartboss **ไม่เรียก Google Ads API เอง** และไม่ถือ token ของ Google — n8n ถือ

## การยืนยันตัวตน

| ทิศทาง | วิธี |
|---|---|
| n8n → Smartboss | `Authorization: Bearer sbads_…` ออก token ที่หน้า **Google Ads › การเชื่อมต่อ n8n** (ผู้ดูแลระบบ) · token ผูกกับบริษัทเดียว · ตัวเต็มแสดงครั้งเดียว · ยกเลิกได้ทันที |
| Smartboss → n8n | Webhook (ตั้ง URL + ออก secret ที่หน้าเดียวกัน) เซ็นทุกครั้งด้วย HMAC-SHA256 ดูหัวข้อ Webhook |

ใน n8n ใช้ credential แบบ **Header Auth**: name `Authorization`, value `Bearer sbads_…`

ทุก endpoint ตอบ JSON · ผิดพลาดตอบ `{ ok: false, error: "ข้อความภาษาไทย" }` พร้อม HTTP 400 / 401 / 403 / 404 / 409
ทุกคำขอที่ใช้ token นับเป็นสัญญาณว่า n8n ยังออนไลน์ (เงียบเกิน 15 นาที แดชบอร์ดขึ้น "ออฟไลน์")

Base URL = โดเมนของ Smartboss เช่น `https://app.<โดเมน>`

---

## 1. สถานะ

### `POST /api/agent/ads/heartbeat`
```json
{ "version": "1.0", "workflow": "ads-daily" }
```
แนะนำให้มี Schedule Trigger ยิงทุก 5 นาที ข้อมูลที่ส่งมาโชว์ที่หน้าการเชื่อมต่อ

---

## 2. ส่งข้อมูลโฆษณาเข้า Smartboss

ลำดับต่อรอบ: `accounts` → `ingest/campaigns` → `ingest/ad-groups` → `ingest/keywords` → `ingest/search-terms` → `ingest/complete`

- ส่งย้อนหลัง 30 วันทุกรอบ (conversion ของวันก่อนยังเปลี่ยนได้) — upsert ทับ ส่งซ้ำได้
- ครั้งละไม่เกิน 5,000 แถว (เกินให้แบ่งส่ง) · body ไม่เกิน 10 MB
- ใช้ชื่อฟิลด์แบบ snake_case แบนตามผล GAQL
- เงิน: ส่ง `cost` เป็นหน่วยเงิน หรือ `cost_micros` ตามที่ Google ส่งมาก็ได้ (หารล้านให้) · `daily_budget` / `daily_budget_micros` เหมือนกัน
- `*_impr_share`, `*_lost_is`, `*_impr_pct` ส่งเป็นเศษส่วน 0–1 ตามที่ API คืนมา
- `date` = `YYYY-MM-DD` · แถวที่ไม่มี `date` = อัปเดตแค่ชื่อ/สถานะ

### `POST /api/agent/ads/accounts`
```json
{ "accounts": [{ "customer_id": "896-928-8097", "name": "baanpoolvilla.com", "currency_code": "THB", "time_zone": "Asia/Bangkok" }] }
```
`GET` = รายชื่อบัญชีที่มี

### `POST /api/agent/ads/ingest/campaigns`
```json
{
  "customer_id": "8969288097",
  "rows": [{
    "campaign_id": "2214", "name": "Pattaya Pool Villa", "status": "ENABLED", "channel_type": "SEARCH",
    "daily_budget_micros": 1500000000, "date": "2026-11-16",
    "impressions": 4000, "clicks": 300, "cost_micros": 1455000000, "conversions": 25, "conversions_value": 0,
    "search_impr_share": 0.62, "search_budget_lost_is": 0.184, "search_rank_lost_is": 0.1,
    "top_impr_pct": 0.7, "abs_top_impr_pct": 0.3
  }]
}
```
GAQL ที่ได้ฟิลด์ครบ:
```sql
SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
       campaign_budget.amount_micros, segments.date,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value,
       metrics.search_impression_share, metrics.search_budget_lost_impression_share,
       metrics.search_rank_lost_impression_share, metrics.top_impression_percentage,
       metrics.absolute_top_impression_percentage
FROM campaign WHERE segments.date DURING LAST_30_DAYS
```

### `POST /api/agent/ads/ingest/ad-groups`
แถว: `ad_group_id, campaign_id, name, status, date, impressions, clicks, cost|cost_micros, conversions, conversions_value, top_impr_pct, abs_top_impr_pct`

### `POST /api/agent/ads/ingest/keywords`
แถว: `criterion_id, ad_group_id, text, match_type, date, impressions, clicks, cost|cost_micros, conversions` (จาก `keyword_view`)

### `POST /api/agent/ads/ingest/search-terms`
แถว: `search_term, ad_group_id, date, impressions, clicks, cost|cost_micros, conversions` (จาก `search_term_view` — แถวซ้ำรวมให้เอง)

### `POST /api/agent/ads/ingest/complete`
```json
{ "customer_id": "8969288097", "from": "2026-10-18", "to": "2026-11-16", "status": "success", "rows_upserted": 28059, "duration_ms": 16236 }
```
`status`: `success | retried | failed` (+ `error`) · สำเร็จแล้ว "ข้อมูลล่าสุดจาก n8n" บนทุกหน้าจะเปลี่ยน

---

## 3. ข้อมูลให้ AI อ่าน (เครื่องมือของ AI Agent node)

ตัวเลขทุกตัวคิดโดย Rule Engine ชุดเดียวกับแดชบอร์ด — AI ไม่ต้องคิดเลขเอง ใช้ `*_status` และ `rule_findings` ได้เลย

### `GET /api/agent/ads/report`
query: `customer_id`, `from`, `to` (ไม่ส่ง = 7 วันล่าสุดถึงเมื่อวาน), `compare` = `previous` (ค่าเริ่มต้น) | `none` | `YYYY-MM-DD,YYYY-MM-DD`

คืน: `account, period, compare, goal, benchmarks, rules, totals (+change %), daily, campaigns, ad_groups, keywords, wasted_search_terms, rule_findings`

### `GET /api/agent/ads/search-terms`
query: `customer_id, from, to, campaign_id, ad_group_id, min_clicks, max_conversions, contains, sort (cost|clicks|impressions|conversions), limit (≤500)`

ตัวอย่าง "คำค้นหาที่ใช้เงินแต่ไม่มี conversion": `?min_clicks=10&max_conversions=0&sort=cost`

### `GET /api/agent/ads/settings`
เกณฑ์ KPI · กฎ · เป้าหมายธุรกิจ (target CPA, บริบทธุรกิจ) · **นโยบายคำขอปรับ** (`allowed_types`, `max_change_pct`, `proposal_expiry_hours`) — AI ควรอ่านก่อนเสนอทุกครั้ง

### `GET /api/agent/ads/proposals`
query: `status` (คั่นด้วย `,`), `since` (ISO), `customer_id`, `limit (≤200)`
ใช้ 2 แบบ: ประวัติให้ AI เรียนรู้ (`status=applied,rejected` — มี `decision_note` = เหตุผลที่คนปฏิเสธ และ `measurement` = ผลหลังปรับ) และตามเก็บงานค้าง (`status=approved`)

> negative keyword ที่มีอยู่แล้วใน Google Ads — n8n อ่านจาก Google เองได้ (มี token อยู่แล้ว) ใช้กันเสนอคำซ้ำ

---

## 4. บทสรุปจาก AI

### `POST /api/agent/ads/summaries`
```json
{
  "customer_id": "8969288097", "period_from": "2026-11-10", "period_to": "2026-11-16",
  "title": "สรุป 7 วัน", "body": "ข้อความยาวได้ ขึ้นบรรทัดใหม่ได้",
  "highlights": [{ "label": "CPA", "value": "฿58", "tone": "good" }],
  "notify": true,
  "chat_text": "ข้อความสั้นที่ส่งเข้าแชท (ไม่ส่ง = ใช้ title + body)"
}
```
โชว์บนแดชบอร์ด · `notify: true` = ส่งเข้ากลุ่ม 🤖 Ads Agent ด้วย · ตอบ `{ ok, id, chat_message_id }`

---

## 5. คำขอปรับ

```
pending ──คนอนุมัติ──► approved ──claim──► executing ──result──► applied | failed | stale
   ├──คนปฏิเสธ──► rejected                                          └─ measurement
   └──เลยเวลา──► expired
```

### ชนิด (`type`)

| type | ต้องส่ง | `proposed` |
|---|---|---|
| `add_negative_keywords` | `ad_group_id` (ระดับกลุ่ม) หรือ `campaign_id` (ระดับแคมเปญ) | `{ "level": "ad_group"\|"campaign", "keywords": [{ "text", "match_type": "EXACT"\|"PHRASE"\|"BROAD", "clicks", "cost", "conversions" }] }` — 1–200 คำ · คนติ๊กออกได้ |
| `pause_keyword` / `enable_keyword` | `target_id` (criterion id), `ad_group_id` | ไม่ต้องส่ง |
| `pause_ad_group` / `enable_ad_group` | `ad_group_id` | ไม่ต้องส่ง |
| `set_campaign_budget` | `campaign_id`, `before.amount` | `{ "amount": 1800 }` หน่วยเงิน (ไม่ใช่ micros) · คนแก้ตัวเลขได้ |
| `set_keyword_bid` | `target_id`, `ad_group_id`, `before.cpc_bid` | `{ "cpc_bid": 12.5 }` · คนแก้ตัวเลขได้ |

งบ/bid ต้องส่ง **ค่าเดิม** มาด้วยเสมอ — ใช้ตรวจเพดาน % ของบริษัท และ n8n ใช้เทียบกับค่าจริงก่อนยิง

### `POST /api/agent/ads/proposals`
```json
{
  "customer_id": "8969288097",
  "type": "set_campaign_budget",
  "campaign_id": "2214", "campaign_name": "Pattaya Pool Villa",
  "before": { "amount": 1500 },
  "proposed": { "amount": 1800 },
  "reason": "เสีย impression share เพราะงบ 18.4% เกินเกณฑ์ 10% และ CPA ฿58 ดีกว่าเป้า",
  "evidence": [{ "label": "budget lost IS", "value": "18.4%" }, { "label": "CPA 7 วัน", "value": "฿58" }],
  "risk": "medium",
  "expected_impact": "conversion เพิ่ม ~10%",
  "source": "ai"
}
```
คนพิมพ์สั่งบอท: `"source": "command", "requested_by_user_id": "<user_id จาก bot.message>"` (การ์ดแท็กคนสั่ง)

ตอบ `{ ok, id, code: "ADS-2569-0001", status: "pending", group_members }` — การ์ดใบเดียวเข้ากลุ่ม (`group_members` = จำนวนคนที่กดได้ · 0 = ยังไม่มีใครในกลุ่ม ไม่มีใครอนุมัติได้) · 400 = ผิดนโยบาย (ชนิดไม่เปิด / เกินเพดาน / ข้อมูลไม่ครบ) · 409 = มีคำขอแบบเดียวกันค้างอยู่ (`existing_id`)

### `GET /api/agent/ads/proposals/:id`
สถานะปัจจุบันเต็ม

### `POST /api/agent/ads/proposals/:id/claim` — **ต้องเรียกก่อนแตะ Google Ads ทุกครั้ง**
จองสิทธิ์ยิง (approved → executing) ตอบ `{ ok, proposal }` — ใช้ `proposal.approved` เสมอ **ไม่ใช่** `proposed` (คนอาจแก้ตัวเลขหรือติ๊กคำออก)
409 = ยังไม่อนุมัติ / มีรอบอื่นจองไปแล้ว / ถูกปฏิเสธ / หมดอายุ → **ห้ามยิง**

### `POST /api/agent/ads/proposals/:id/result`
```json
{ "status": "applied", "result": { "resource_names": ["customers/…/adGroupCriteria/…"] } }
{ "status": "stale", "error": "งบรายวันใน Google ตอนนี้ ฿2,000 ไม่ใช่ ฿1,500 แบบตอนเสนอ" }
{ "status": "failed", "error": "ข้อความ error จาก Google" }
```
`stale` = ค่าจริงใน Google ไม่ตรง `before` (มีคนแก้ในหน้า Google Ads) — ไม่ยิง · ล้มเหลว/stale บอทโพสต์ในกลุ่มและแท็กคนที่อนุมัติ

### `POST /api/agent/ads/proposals/:id/measurement`
```json
{ "days": 7, "summary": "ค่าใช้จ่ายจากคำนี้เหลือ 0 · conversion ของกลุ่มไม่ลด", "metrics": { "cost_before": 1190, "cost_after": 0 } }
```
เฉพาะคำขอที่ applied · ขึ้นในการ์ดเดิม (ส่งซ้ำวันเดียวกันได้ ทับของเดิม)

---

## 6. กลุ่มแชท 🤖 Ads Agent

**กลุ่มรวมห้องเดียวต่อบริษัท** — สร้างเองตอนบอทส่งข้อความแรก ใส่ผู้ดูแลโมดูล (สิทธิ์ `ads.admin`) เป็นแอดมินกลุ่ม
แล้วแอดมินกลุ่มเพิ่ม/เอาคนออกที่เมนูสมาชิกของกลุ่มในแชทตามปกติ

- **สมาชิกกลุ่ม = คนที่กดอนุมัติ/ปฏิเสธได้ทั้งหมด** ไม่ต้องมี permission อื่น (คนนอกกลุ่มกดไม่ได้ แม้จะเห็นการ์ดในหน้าคำขอปรับ)
- **การ์ดใบเดียว** ทุกคนเห็นใบเดียวกัน · **กดได้ครั้งเดียว คนแรกชนะ** — คนที่สองได้ข้อความ "มีคนตัดสินไปแล้ว" และปุ่มหายจากทุกคนทันที
- นโยบาย "คนสั่งอนุมัติของตัวเองได้ไหม" ตั้งที่หน้าการเชื่อมต่อ n8n (ปิด = คนพิมพ์สั่งต้องรอสมาชิกคนอื่นกด)
- สมาชิกคนไหนพิมพ์ในกลุ่ม → Smartboss ส่ง webhook `bot.message` ให้ n8n

### `GET /api/agent/ads/group`
```json
{ "channel_id": "adsbot-<org_id>", "members": [{ "user_id": "…", "name": "คุณกฤษ" }] }
```
สมาชิกตอนนี้ (= คนที่อนุมัติได้) — ใช้แท็กคน หรือให้ AI รู้ว่าใครอยู่ในกลุ่ม

### `POST /api/agent/ads/messages`
```json
{ "text": "Bangkok Pool Villa ครับ", "reply_to_message_id": "<message_id จาก bot.message>", "mention_user_ids": ["<user_id จาก bot.message>"] }
```
โพสต์เข้ากลุ่ม · `reply_to_message_id` = ตอบกลับข้อความนั้น · `mention_user_ids` = แท็ก (เด้งหาคนนั้นแม้ปิดเสียงกลุ่ม · แท็กได้เฉพาะสมาชิก) · ไม่เกิน 4,000 ตัวอักษร
ตอบ `{ ok, message_id, members }`

### `POST /api/agent/ads/typing`
ไม่ต้องมี body — ขึ้น "Ads Agent กำลังพิมพ์…" ในกลุ่มไม่กี่วินาที ส่งซ้ำระหว่าง AI คิดได้

---

## 7. Webhook (Smartboss → n8n)

```
POST <Webhook URL>
X-Smartboss-Event:     bot.message | proposal.approved | proposal.rejected | ping
X-Smartboss-Timestamp: 1763362800
X-Smartboss-Signature: sha256=<hex>
{ "event": "...", "org_id": "...", "sent_at": "ISO", "data": { ... } }
```

**ตรวจลายเซ็นก่อนทำอะไร**: `hex(HMAC_SHA256(secret, "<timestamp>.<raw body>"))` ต้องตรงกับหลัง `sha256=` และ timestamp ต้องไม่เก่าเกิน 5 นาที
(ใน n8n: Webhook node → Code node ใช้ `crypto.createHmac` · ต้องเปิด raw body ของ Webhook node)

| event | data | n8n ควรทำ |
|---|---|---|
| `bot.message` | `user_id, user_name, message_id, reply_to_message_id, text, sent_at, can_approve` (สมาชิกกลุ่ม = `true` เสมอ) | ให้ AI อ่าน → ตอบด้วย `/messages` (reply + แท็กคนถาม) หรือสร้างคำขอด้วย `source: "command"` |
| `proposal.approved` | `id, code, type, customer_id` | `claim` → อ่านค่าจริงจาก Google → เทียบ `before` → mutate → `result` |
| `proposal.rejected` | `id, code, type, customer_id, reason` | เก็บไว้ให้ AI เรียนรู้ (ดึงทีหลังจาก `GET /proposals?status=rejected` ก็ได้) |
| `ping` | `message` | ตอบ 200 (ปุ่มทดสอบในหน้าการเชื่อมต่อ) |

Smartboss ส่งครั้งเดียว ไม่ลองซ้ำ — เครื่อง n8n อาจปิดอยู่ ให้มี workflow ตามเก็บ: ตอนเริ่ม + ทุก 5 นาที
`GET /api/agent/ads/proposals?status=approved` แล้ว claim ทีละใบ

ถ้าส่ง `bot.message` ไม่ถึง n8n บอทจะตอบในแชทเองว่า "ตอนนี้ติดต่อ n8n ไม่ได้"

---

## กฎความปลอดภัยฝั่ง n8n

1. **AI Agent node มีแต่เครื่องมืออ่าน** (`report`, `search-terms`, `settings`, `group`, `proposals` GET, การอ่าน Google Ads) และเครื่องมือ `POST /proposals` — **ห้ามมีเครื่องมือที่ mutate Google Ads**
2. workflow ที่ mutate Google Ads แยกตัว ไม่มี AI · เริ่มจาก `proposal.approved` (ตรวจลายเซ็นแล้ว) หรือ workflow ตามเก็บเท่านั้น · `claim` ก่อนทุกครั้ง
3. ใช้ `approved` ไม่ใช่ `proposed` · เทียบ `before` กับค่าจริงก่อนยิง ไม่ตรง = `stale`
4. จำกัดคนแก้ workflow ใน n8n — ใครแก้ workflow ที่ mutate ได้ = ปรับ Google Ads ได้โดยไม่ผ่านอนุมัติ
5. หน้าจัดการ n8n ห้ามเปิดสู่อินเทอร์เน็ต — Cloudflare Tunnel เปิดเฉพาะ path `/webhook/`
