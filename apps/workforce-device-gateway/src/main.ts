import { randomUUID } from 'node:crypto';
import { loadDotenvFile } from '@workforce/config';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';

loadDotenvFile();

/**
 * Device gateway — ขอบเขตที่เครื่องสแกนคุยด้วย
 *
 * ทำไมต้องแยกโปรเซส: เครื่องสแกนอยู่ตามไซต์งานและต่อเน็ตสาธารณะ ถ้าให้ยิงเข้า API
 * ตรง ๆ แปลว่า API ที่มีทั้งข้อมูลเงินเดือนและ HR ต้องเปิดสู่อินเทอร์เน็ต
 * gateway ตัวนี้เปิดเฉพาะ path ที่เครื่องต้องใช้ ส่วน API อยู่ในเครือข่ายภายในได้
 *
 * gateway *ไม่* ตรวจลายเซ็นซ้ำ — การตรวจต้องใช้ public key ในฐานข้อมูล การให้
 * gateway ต่อ DB เท่ากับขยายพื้นที่เสี่ยงกลับไปเท่าเดิม หน้าที่ที่นี่คือกรอง path,
 * จำกัดขนาด/อัตรา แล้วส่งต่อ ส่วนการตัดสินใจว่าเชื่อถือได้ไหมเป็นของ API
 */

const PORT = Number(process.env['GATEWAY_PORT'] ?? 3200);
const HOST = process.env['GATEWAY_HOST'] ?? '0.0.0.0';
const UPSTREAM = process.env['GATEWAY_UPSTREAM'] ?? 'http://127.0.0.1:3100';
const PREFIX = '/api/workforce/v1';

/** 1 MB เท่ากับ bodyLimit ของ API — ปฏิเสธที่ขอบดีกว่าปล่อยเข้าไปให้ API ปฏิเสธ */
const BODY_LIMIT = 1_048_576;

/**
 * เฉพาะ path ที่เครื่องสแกนต้องใช้จริง
 * ทุกอย่างนอกรายการนี้ตอบ 404 — เครื่องที่ถูกยึดจึงเข้าถึง endpoint ของ HR ไม่ได้
 */
const ALLOWED: { method: string; path: string }[] = [
  { method: 'POST', path: `${PREFIX}/device-activation` },
  { method: 'POST', path: `${PREFIX}/device-ingestion/time-events:batch` },
  { method: 'POST', path: `${PREFIX}/device-ingestion/heartbeats` },
  { method: 'GET', path: `${PREFIX}/device-ingestion/sync-state` },
  { method: 'GET', path: `${PREFIX}/device-ingestion/commands` },
  { method: 'POST', path: `${PREFIX}/device-ingestion/commands:ack` },
];

/** โควตาต่อเครื่องต่อนาที — เครื่องปกติส่งไม่เกินไม่กี่ครั้งต่อนาที */
const RATE_LIMIT_PER_MINUTE = Number(process.env['GATEWAY_RATE_LIMIT'] ?? 120);
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function overRateLimit(deviceId: string, now: number): boolean {
  const bucket = rateBuckets.get(deviceId);

  if (bucket === undefined || now >= bucket.resetAt) {
    rateBuckets.set(deviceId, { count: 1, resetAt: now + 60_000 });
    return false;
  }

  bucket.count += 1;
  return bucket.count > RATE_LIMIT_PER_MINUTE;
}

/** เก็บกวาด bucket ที่หมดอายุ ไม่ให้ Map โตไม่รู้จบเมื่อเครื่องถูกปลดระวาง */
setInterval(() => {
  const now = Date.now();
  for (const [deviceId, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(deviceId);
  }
}, 60_000).unref();

const app = Fastify({
  logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  bodyLimit: BODY_LIMIT,
  trustProxy: true,
  genReqId: () => randomUUID(),
});

/*
 * รับ body เป็น Buffer ดิบและส่งต่อโดยไม่แตะ
 *
 * สำคัญมาก: ลายเซ็นของเครื่องคำนวณจาก sha256 ของไบต์ที่ส่งจริง ถ้า gateway parse
 * JSON แล้ว stringify ใหม่ ลำดับ key หรือช่องว่างอาจเปลี่ยน แล้วลายเซ็นจะพังทุกใบ
 */
// ต้องถอด parser ที่ Fastify ติดมาให้ก่อน — parser ของ application/json ชนะ
// wildcard เสมอ ถ้าไม่ถอด body จะกลายเป็น object ที่ถูก serialize ใหม่ตอนส่งต่อ
// แล้วลายเซ็นของทุกเครื่องจะพังพร้อมกัน
app.removeAllContentTypeParsers();
app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
  done(null, body);
});

app.get('/healthz', async () => ({ status: 'ok', upstream: UPSTREAM }));

async function forward(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = request.url.split('?')[0] ?? request.url;
  const allowed = ALLOWED.some((entry) => entry.method === request.method && entry.path === path);

  if (!allowed) {
    await reply.status(404).send({
      type: 'urn:workforce:error:not-found',
      title: 'endpoint not available through the device gateway',
      status: 404,
      code: 'NOT_FOUND',
      request_id: request.id,
    });
    return;
  }

  const deviceId = request.headers['x-device-id'];
  if (typeof deviceId === 'string' && overRateLimit(deviceId, Date.now())) {
    request.log.warn({ deviceId }, 'device exceeded rate limit');
    await reply.status(429).send({
      type: 'urn:workforce:error:rate-limited',
      title: 'too many requests from this device',
      status: 429,
      code: 'RATE_LIMITED',
      request_id: request.id,
    });
    return;
  }

  // ส่งต่อเฉพาะ header ที่จำเป็น — ไม่ยกทั้งชุดเพื่อไม่ให้ header แปลกปลอมทะลุเข้าไป
  const headers: Record<string, string> = { 'x-request-id': String(request.id) };
  for (const name of [
    'content-type',
    'x-device-id',
    'x-device-timestamp',
    'x-device-signature',
    'idempotency-key',
  ]) {
    const value = request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }

  const forwardedFor = request.headers['x-forwarded-for'];
  headers['x-forwarded-for'] =
    typeof forwardedFor === 'string' ? `${forwardedFor}, ${request.ip}` : request.ip;

  try {
    const upstream = await fetch(`${UPSTREAM}${request.url}`, {
      method: request.method,
      headers,
      ...(request.method === 'GET' || request.body === undefined
        ? {}
        : { body: request.body as Buffer }),
      signal: AbortSignal.timeout(20_000),
    });

    const payload = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type');
    if (contentType !== null) void reply.header('content-type', contentType);

    await reply.status(upstream.status).send(payload);
  } catch (error) {
    /*
     * API ล่มหรือช้า — ตอบ 503 เพื่อให้เครื่องเก็บ event ไว้ในคิวแล้วลองใหม่
     * ห้ามตอบ 2xx เด็ดขาด เครื่องจะลบ event ทิ้งทั้งที่ยังไม่มีใครรับ
     */
    request.log.error({ err: error }, 'upstream request failed');
    await reply.status(503).send({
      type: 'urn:workforce:error:upstream-unavailable',
      title: 'ingestion service is temporarily unavailable',
      status: 503,
      code: 'UPSTREAM_UNAVAILABLE',
      request_id: request.id,
    });
  }
}

app.route({ method: ['GET', 'POST'], url: '/*', handler: forward });

async function start(): Promise<void> {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`device-gateway listening on ${HOST}:${String(PORT)} → ${UPSTREAM}`);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      process.exit(0);
    });
  });
}

start().catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
