/**
 * ตัวจำลองเครื่องสแกนลายนิ้วมือ — ใช้เทสระบบลงเวลาโดยยังไม่มีเครื่องจริง
 *
 * ต่างจาก `verify-device-protocol.mjs` ตรงที่ตัวนั้นพิสูจน์โปรโตคอลรอบเดียวจบ
 * (สร้างเครื่องใหม่ทุกครั้ง) ส่วนตัวนี้ **เก็บกุญแจไว้ใช้ซ้ำ** จึงยิงสแกนกี่ครั้งก็ได้
 *
 * ── ทำไมต้องมีสคริปต์นี้แทนที่จะยิง Postman ตรง ๆ ──
 * ทุก request ที่ "เครื่อง" เป็นคนยิงต้องแนบลายเซ็น Ed25519 ของตัวเอง
 * (ดู packages/workforce/domain/src/devices/device-signature.ts) ซึ่ง sandbox
 * ของ Postman ทำไม่ได้ — มีแต่ crypto-js ที่ไม่มี Ed25519
 *
 * ส่วนที่ Postman ยิงเองได้ทั้งหมดคือฝั่งผู้ดูแล (Bearer token ธรรมดา) และ
 * `POST /device-activation` กับ `POST /legacy/attendance` ที่ไม่ต้องเซ็น
 *
 * ── วิธีใช้ ──
 *   node scripts/device-sim.mjs setup            เตรียมเครื่อง + ลงทะเบียนนิ้ว (ทำครั้งเดียว)
 *   node scripts/device-sim.mjs scan             ยิงสแกน 1 ครั้ง (เส้นทางจริง มีลายเซ็น)
 *   node scripts/device-sim.mjs scan --slot 7 --intent CLOCK_IN
 *   node scripts/device-sim.mjs pending          ดูคำสั่งค้าง + ack ให้หมด
 *   node scripts/device-sim.mjs info             แสดงค่าที่ต้องเอาไปใส่ใน Postman
 *
 * ── env ──
 *   WORKFORCE_URL   origin ของ API            (ค่าเริ่มต้น http://127.0.0.1:4100)
 *   TOKEN           access token ของ Smartboss (ถ้าไม่ใส่จะ login ให้เอง)
 *   SMARTBOSS_URL   origin ของเว็บ            (ค่าเริ่มต้น http://localhost:3100)
 *   EMAIL/PASSWORD  บัญชีที่ใช้ login          (ค่าเริ่มต้น hr@easyboss.app / Demo@12345)
 *   DEVICE_CODE     รหัสเครื่องจำลอง          (ค่าเริ่มต้น SIM-01)
 *   STATE_FILE      ที่เก็บกุญแจของเครื่อง     (ค่าเริ่มต้น .device-sim.json ข้าง ๆ repo)
 *
 * กุญแจส่วนตัวของเครื่องถูกเขียนลงไฟล์ state — **อย่า commit** (.gitignore คลุม .device-sim.json แล้ว)
 */
import { generateKeyPairSync, createPrivateKey, createHash, sign, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "/api/workforce/v1";
const BASE = (process.env.WORKFORCE_URL ?? "http://127.0.0.1:4100").replace(/\/+$/, "") + PREFIX;
const SMARTBOSS = (process.env.SMARTBOSS_URL ?? "http://localhost:3100").replace(/\/+$/, "");
const DEVICE_CODE = process.env.DEVICE_CODE ?? "SIM-01";
const STATE_FILE = process.env.STATE_FILE ?? resolve(REPO, ".device-sim.json");

const [command = "info", ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? fallback : rest[i + 1];
};

/* ────────── state ของเครื่อง (id + กุญแจ) ────────── */

function loadState() {
  if (!existsSync(STATE_FILE)) return null;
  return JSON.parse(readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function requireState() {
  const state = loadState();
  if (state === null || state.deviceCode !== DEVICE_CODE) {
    throw new Error(`ยังไม่ได้เตรียมเครื่อง ${DEVICE_CODE} — รัน: node scripts/device-sim.mjs setup`);
  }
  return state;
}

/* ────────── ฝั่งผู้ดูแล: Bearer token (Postman ทำได้เหมือนกัน) ────────── */

let token = process.env.TOKEN ?? null;

async function getToken() {
  if (token !== null) return token;
  const res = await fetch(`${SMARTBOSS}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.EMAIL ?? "hr@easyboss.app",
      password: process.env.PASSWORD ?? "Demo@12345",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `login ไม่ผ่าน (HTTP ${res.status}) — ตั้ง TOKEN=... เองได้ถ้าเว็บยังไม่ได้รัน`
    );
  }
  const found = /sb_access=([^;]+)/.exec(res.headers.getSetCookie().join("; "));
  if (found === null) throw new Error("login ผ่านแต่ไม่เจอ cookie sb_access");
  token = found[1];
  return token;
}

async function admin(method, path, body) {
  const headers = { authorization: `Bearer ${await getToken()}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  // ทุก mutation ของ workforce บังคับ Idempotency-Key (ADR-0008)
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
  if (!res.ok) {
    throw new Error(`${method} ${path} → HTTP ${res.status}\n${JSON.stringify(parsed)}`);
  }
  return parsed;
}

/* ────────── ฝั่งเครื่อง: ต้องเซ็นทุก request ────────── */

/** ต้องตรงกับ buildSigningPayload() ใน @workforce/domain เป๊ะ ๆ */
function deviceHeaders(state, method, path, rawBody) {
  const timestamp = new Date().toISOString();
  const bodyHash = createHash("sha256").update(rawBody ?? "", "utf8").digest("hex");
  const payload = Buffer.from(
    [
      "workforce-device-v1",
      state.deviceId,
      timestamp,
      method.toUpperCase(),
      `${PREFIX}${path}`,
      bodyHash,
    ].join("\n"),
    "utf8"
  );
  return {
    "x-device-id": state.deviceId,
    "x-device-timestamp": timestamp,
    "x-device-signature": sign(null, payload, createPrivateKey(state.privateKeyPem)).toString(
      "base64"
    ),
  };
}

async function device(state, method, path, body) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const headers = deviceHeaders(state, method, path, raw);
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: raw }),
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

/* ────────── ack คำสั่งค้างทั้งหมด (ขั้นที่ Postman ทำแทนไม่ได้) ────────── */

async function ackPending(state) {
  const commands = await device(state, "GET", "/device-ingestion/commands");
  if (commands.status !== 200) {
    throw new Error(`ถามคำสั่งไม่ผ่าน HTTP ${commands.status}: ${JSON.stringify(commands.body)}`);
  }
  const items = commands.body.items ?? [];
  if (items.length === 0) {
    console.log("ไม่มีคำสั่งค้าง");
    return 0;
  }

  for (const cmd of items) {
    // เครื่องจริงจะเรียกเซ็นเซอร์ตรงนี้ — ตัวจำลองตอบว่าสำเร็จทันที
    const result = await device(state, "POST", "/device-ingestion/commands:ack", {
      nonce: cmd.nonce,
      outcome: "SUCCESS",
      result: { detail: `simulated ${cmd.command_type}`, firmware_version: "sim-1.0.0" },
    });
    console.log(
      `ack ${cmd.command_type} slot=${cmd.payload?.template_slot ?? "-"} → HTTP ${result.status}`
    );
  }
  return items.length;
}

/* ═══════════════════════ คำสั่ง ═══════════════════════ */

async function setup() {
  const companies = await admin("GET", "/companies");
  const company = companies.items[0];
  if (company === undefined) {
    throw new Error("ยังไม่มีนิติบุคคล — เปิดบริษัทใน Smartboss ก่อน");
  }

  const employments = await admin("GET", "/employments");
  const employmentId = flag("employment", employments.items[0]?.id);
  if (employmentId === undefined) {
    throw new Error("ยังไม่มีพนักงาน — เพิ่มที่ /hr/employees/new ก่อน");
  }
  const who = employments.items.find((e) => e.id === employmentId);
  const slot = Number(flag("slot", "1"));

  // เครื่องที่มีอยู่แล้วใช้ซ้ำ ไม่สร้างใหม่ — เรียก setup ซ้ำได้
  const devices = await admin("GET", "/devices");
  let record = devices.items.find((d) => d.device_code === DEVICE_CODE);
  if (record === undefined) {
    record = await admin("POST", "/devices", {
      company_id: company.id,
      device_code: DEVICE_CODE,
      name: "เครื่องจำลอง (ยังไม่มีเครื่องจริง)",
      device_type: "FINGERPRINT_TERMINAL",
    });
    console.log(`สร้างเครื่อง ${DEVICE_CODE} แล้ว`);
  } else {
    console.log(`ใช้เครื่อง ${DEVICE_CODE} ที่มีอยู่แล้ว (สถานะ ${record.status})`);
  }

  // เครื่องสร้างคู่กุญแจเอง ส่งขึ้นไปแค่ public key — private key ไม่เคยออกจาก "เครื่อง"
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const activation = await admin("POST", `/devices/${record.id}/activation-tokens`, {});
  const activated = await fetch(`${BASE}/device-activation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activation_token: activation.activation_token,
      public_key: publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64"),
      firmware_version: "sim-1.0.0",
    }),
  });
  if (!activated.ok) {
    throw new Error(`activate ไม่ผ่าน HTTP ${activated.status}: ${await activated.text()}`);
  }

  const state = {
    deviceCode: DEVICE_CODE,
    deviceId: record.id,
    companyId: company.id,
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }),
    sequence: 0,
  };
  saveState(state);
  console.log(`activate แล้ว — device_id ${record.id}`);

  // ลงทะเบียนนิ้ว: ผู้ดูแลสั่ง (PENDING) แล้วเครื่อง ack ให้เป็น ACTIVE
  // ถ้าไม่ ack การสแกนจะไม่ผูกกับใคร แล้วผลลงเวลาจะขึ้นว่าขาดงานทุกวัน
  await admin("POST", "/biometric-enrollments", {
    employment_id: employmentId,
    device_id: record.id,
    template_slot: slot,
    finger_position: "RIGHT_INDEX",
  });
  console.log(`สั่งลงทะเบียนนิ้ว slot ${slot} ให้ ${who?.full_name ?? employmentId}`);
  await ackPending(state);

  const after = await admin("GET", `/biometric-enrollments?employment_id=${employmentId}`);
  const row = (after.items ?? []).find((r) => r.template_slot === slot);
  console.log(`\nสถานะการลงทะเบียน: ${row?.status ?? "(ไม่พบ)"}`);
  console.log(
    row?.status === "ACTIVE"
      ? "✓ พร้อมแล้ว — สแกน slot นี้จะผูกกับพนักงานคนนี้"
      : "✗ ยังไม่ ACTIVE — ยิง scan ไปก็จะไม่ผูกกับใคร"
  );
  info();
}

async function scan() {
  const state = requireState();
  const slot = Number(flag("slot", "1"));
  const intent = flag("intent", "AUTO");
  const at = flag("at", new Date().toISOString());

  state.sequence += 1;
  saveState(state);

  const result = await device(state, "POST", "/device-ingestion/time-events:batch", {
    batch_id: randomUUID(),
    device_time: new Date().toISOString(),
    firmware_version: "sim-1.0.0",
    queue_depth: 0,
    events: [
      {
        event_id: randomUUID(),
        sequence: state.sequence,
        captured_at: at,
        timezone: "Asia/Bangkok",
        event_intent: intent,
        template_slot: slot,
        evidence: { match_score: 92, sensor_quality: 88 },
      },
    ],
  });
  console.log(`สแกน slot ${slot} (${intent}) เวลา ${at} → HTTP ${result.status}`);
  console.log(JSON.stringify(result.body, null, 2));
}

async function pending() {
  await ackPending(requireState());
}

function info() {
  const state = loadState();
  console.log(`
── ค่าที่เอาไปใส่ Postman ──
  workforce API : ${BASE}
  device_code   : ${DEVICE_CODE}
  device_id     : ${state?.deviceId ?? "(ยังไม่ setup)"}

Postman ยิงเองได้: ทุก endpoint ฝั่งผู้ดูแล (ใส่ header authorization: Bearer <token>)
  GET  /companies · /employments · /devices · /biometric-enrollments
  POST /devices · /devices/:id/activation-tokens · /biometric-enrollments
       (POST ต้องมี header idempotency-key ด้วย ใส่ค่าอะไรก็ได้ที่ไม่ซ้ำ)

Postman จำลอง "การสแกน" ได้ผ่าน legacy adapter (ไม่ต้องเซ็น):
  POST ${BASE}/legacy/attendance
  header  x-legacy-ingest-key: <ค่าใน LEGACY_INGEST_KEY ของ workforce API>
  body    {"device_id": "${DEVICE_CODE}", "finger_id": 1}

  ⚠ event จาก legacy จะถูกทำเครื่องหมาย LEGACY_UNTRUSTED และใช้เวลาของ server
    (firmware เดิมไม่ส่งเวลามา) — ใช้เทสได้ แต่ไม่ใช่เส้นทางเดียวกับเครื่องจริง
    เส้นทางจริงใช้: node scripts/device-sim.mjs scan
`);
}

const commands = { setup, scan, pending, info: async () => info() };
const run = commands[command];
if (run === undefined) {
  console.error(`ไม่รู้จักคำสั่ง "${command}" — ใช้ได้: ${Object.keys(commands).join(", ")}`);
  process.exitCode = 1;
} else {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
