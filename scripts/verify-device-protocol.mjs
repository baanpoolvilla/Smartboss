/**
 * จำลองเครื่อง ESP32 ตามโค้ดเฟิร์มแวร์ที่เพิ่งแก้ เพื่อพิสูจน์ว่าโปรโตคอลถูกต้อง
 *
 * ทำตามลำดับเดียวกับ command_task ใน main.c:
 *   GET /device-ingestion/commands  →  ทำคำสั่ง  →  POST /device-ingestion/commands:ack
 *
 * จุดที่ต้องตรงกับเฟิร์มแวร์เป๊ะ ๆ:
 *   - payload ที่เซ็น: "workforce-device-v1\n<id>\n<ts>\n<METHOD>\n<path>\n<sha256hex(body)>"
 *   - GET เซ็นด้วย body ว่าง (sha256 ของสตริงว่าง)
 *   - nonce ส่งกลับตรงตามที่ได้รับ ไม่แปลง
 *   - ไม่ส่ง template_hash (ไดรเวอร์อ่าน template ไม่ได้)
 */
import { generateKeyPairSync, sign, createHash, randomUUID } from "node:crypto";

/*
 * ปลายทางตั้งผ่าน env ได้ เพื่อใช้ตรวจระบบจริงหลัง deploy ไม่ใช่แค่เครื่อง dev
 *
 *   SMARTBOSS_URL=https://app.example.com \
 *   WORKFORCE_URL=https://device.example.com \
 *   VERIFY_EMAIL=hr@... VERIFY_PASSWORD=... node scripts/verify-device-protocol.mjs
 *
 * WORKFORCE_URL ใส่แค่ origin — สคริปต์เติม /api/workforce/v1 ให้เอง เหมือนที่เฟิร์มแวร์ทำ
 */
const SMARTBOSS = (process.env.SMARTBOSS_URL ?? "http://localhost:3100").replace(/\/+$/, "");
const PREFIX = "/api/workforce/v1";
const BASE = (process.env.WORKFORCE_URL ?? "http://localhost:4100").replace(/\/+$/, "") + PREFIX;
const EMAIL = process.env.VERIFY_EMAIL ?? "hr@easyboss.app";
const PASSWORD = process.env.VERIFY_PASSWORD ?? "Demo@12345";

console.log(`Smartboss: ${SMARTBOSS}\nworkforce: ${BASE}\n`);

let step = 0;
function show(label, status, body) {
  step += 1;
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const ok = status >= 200 && status < 300;
  console.log(`\n[${step}] ${ok ? "OK " : "!! "} ${label}  →  HTTP ${status}`);
  console.log("    " + (text.length > 400 ? text.slice(0, 400) + " …" : text));
  return ok;
}

// ── 1) login Smartboss เอา token ใบเดียวกับที่หน้าเว็บใช้ ──
const login = await fetch(`${SMARTBOSS}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const setCookie = login.headers.getSetCookie().join("; ");
const TOKEN = /sb_access=([^;]+)/.exec(setCookie)?.[1];
if (!TOKEN) throw new Error("ไม่ได้ token จาก Smartboss");
console.log("login Smartboss: OK");

async function api(method, path, body) {
  const headers = { authorization: `Bearer ${TOKEN}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["idempotency-key"] = randomUUID();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

// ── 2) เตรียมเครื่อง (ฝั่งผู้ดูแล) ──
const companies = await api("GET", "/companies");
const COMPANY = companies.body.items?.[0]?.id;
if (!COMPANY) throw new Error("ยังไม่มี company");

const employments = await api("GET", "/employments");
const EMP = employments.body.items?.[0]?.id;
if (!EMP) throw new Error("ยังไม่มีพนักงาน");

const deviceCode = `ESP-${Date.now().toString(36).toUpperCase()}`;
const created = await api("POST", "/devices", {
  company_id: COMPANY,
  device_code: deviceCode,
  name: "เครื่องทดสอบโปรโตคอล",
  device_type: "FINGERPRINT_TERMINAL",
});
show(`POST /devices (${deviceCode})`, created.status, created.body);
const deviceId = created.body.id;

const activation = await api("POST", `/devices/${deviceId}/activation-tokens`, {});
show("POST /devices/:id/activation-tokens", activation.status, activation.body);

// ── 3) เครื่องสร้างคู่กุญแจเอง แล้วส่งเฉพาะ public key (เหมือน wf_identity_provision) ──
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyBase64 = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

const activated = await fetch(`${BASE}/device-activation`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    activation_token: activation.body.activation_token,
    public_key: publicKeyBase64,
    firmware_version: "2.0.0",
  }),
});
const activatedBody = await activated.json();
show("POST /device-activation (เครื่องส่ง public key ของตัวเอง)", activated.status, activatedBody);

/** สร้าง header แบบเดียวกับ wf_identity_sign_request() */
function deviceHeaders(method, path, rawBody) {
  const timestamp = new Date().toISOString();
  const bodyHash = createHash("sha256").update(rawBody ?? "", "utf8").digest("hex");
  const payload = Buffer.from(
    ["workforce-device-v1", deviceId, timestamp, method.toUpperCase(), `${PREFIX}${path}`, bodyHash].join("\n"),
    "utf8",
  );
  return {
    "x-device-id": deviceId,
    "x-device-timestamp": timestamp,
    "x-device-signature": sign(null, payload, privateKey).toString("base64"),
  };
}

// ── 4) ผู้ดูแลสั่งลงทะเบียนลายนิ้วมือ ──
const enrolled = await api("POST", "/biometric-enrollments", {
  employment_id: EMP,
  device_id: deviceId,
  template_slot: 12,
  finger_position: "RIGHT_INDEX",
});
show("POST /biometric-enrollments (สั่งลงทะเบียนนิ้ว slot 12)", enrolled.status, enrolled.body);
console.log(`    สถานะตอนนี้: ${enrolled.body.status}  ← ต้องเป็น PENDING`);

// ── 5) command_task: GET commands ──
const cmdPath = "/device-ingestion/commands";
const cmdRes = await fetch(`${BASE}${cmdPath}`, { headers: deviceHeaders("GET", cmdPath, "") });
const cmdBody = await cmdRes.json();
show("GET /device-ingestion/commands (เครื่องถามคำสั่ง)", cmdRes.status, cmdBody);

const command = (cmdBody.items ?? [])[0];
if (!command) throw new Error("ไม่ได้รับคำสั่ง — เฟิร์มแวร์จะไม่มีอะไรทำ");
console.log(`    ได้คำสั่ง: ${command.command_type} slot=${command.payload?.template_slot}`);

// ── 6) execute_command(): เฟิร์มแวร์เรียก wf_as608_enroll(slot) ตรงนี้ ──
console.log("    → เฟิร์มแวร์เรียก wf_as608_enroll(12) แล้วรอผล (จำลองว่าสำเร็จ)");

// ── 7) ack_command(): ส่งผลกลับ ──
const ackPath = "/device-ingestion/commands:ack";
const ackBody = JSON.stringify({
  nonce: command.nonce,
  outcome: "SUCCESS",
  result: { detail: "enrolled slot 12", firmware_version: "2.0.0" },
});
const ackRes = await fetch(`${BASE}${ackPath}`, {
  method: "POST",
  headers: { ...deviceHeaders("POST", ackPath, ackBody), "content-type": "application/json" },
  body: ackBody,
});
const ackJson = await ackRes.json();
show("POST /device-ingestion/commands:ack (เครื่องยืนยันผล)", ackRes.status, ackJson);

// ── 8) ตรวจว่าการลงทะเบียนเปลี่ยนเป็น ACTIVE จริง ──
const after = await api("GET", `/biometric-enrollments?employment_id=${EMP}`);
const row = (after.body.items ?? []).find((r) => r.template_slot === 12);
console.log(`\n[ผลลัพธ์] สถานะการลงทะเบียนหลัง ack: ${row?.status ?? "(ไม่พบ)"}`);
console.log(
  row?.status === "ACTIVE"
    ? "✓ สำเร็จ — การสแกนหลังจากนี้จะผูกกับพนักงานได้แล้ว"
    : "✗ ยังไม่ ACTIVE — โปรโตคอลยังไม่ครบ",
);

// ── 9) ack ซ้ำต้องถูกปฏิเสธ (nonce ใช้ครั้งเดียว) ──
const replay = await fetch(`${BASE}${ackPath}`, {
  method: "POST",
  headers: { ...deviceHeaders("POST", ackPath, ackBody), "content-type": "application/json" },
  body: ackBody,
});
console.log(`\n[replay] ack ด้วย nonce เดิมอีกครั้ง → HTTP ${replay.status} (ต้องไม่ใช่ 200)`);

