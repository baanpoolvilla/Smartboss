import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { API_BASE_PATH, problemDetailsSchema } from './common';

/** response ทั่วไปสำหรับ endpoint ที่ยังไม่ได้ประกาศ schema ละเอียด */
const genericResponseSchema = z.record(z.unknown());
import { ROUTES, type RouteDefinition } from './routes';
import { OPERATIONAL_ROUTES } from './routes-operational';

/**
 * รวมสองทะเบียนเข้าด้วยกัน
 *
 * `ROUTES` มี request/response schema ละเอียดสำหรับ endpoint หลัก
 * `OPERATIONAL_ROUTES` ครอบคลุมทั้ง API surface เพื่อไม่ให้ OpenAPI ตกหล่น
 * เมื่อ path+method ซ้ำกัน รายการที่มี schema ชนะ
 */
function allRoutes(): RouteDefinition[] {
  const detailed = new Map(ROUTES.map((route) => [`${route.method} ${route.path}`, route]));
  const merged: RouteDefinition[] = [...ROUTES];

  for (const route of OPERATIONAL_ROUTES) {
    const key = `${route.method} ${route.path}`;
    if (detailed.has(key)) continue;
    merged.push({ ...route, response: genericResponseSchema } as RouteDefinition);
  }

  return merged;
}

type JsonObject = Record<string, unknown>;

/**
 * zodToJsonSchema พยายาม infer โครงสร้างของ schema ที่ส่งเข้าไปทั้งก้อน
 * ซึ่งกับ schema ที่ซ้อนหลายชั้นทำให้ TypeScript ชน instantiation depth limit
 * เราสนใจแค่ผลลัพธ์ที่เป็น JSON ธรรมดา จึงตัด inference ทิ้งตรงนี้จุดเดียว
 */
const convertToJsonSchema = zodToJsonSchema as unknown as (
  schema: unknown,
  options: { name: string; target: 'openApi3'; $refStrategy: 'none' },
) => JsonObject;

function toJsonSchema(schema: z.ZodTypeAny, name: string): JsonObject {
  return convertToJsonSchema(schema, { name, target: 'openApi3', $refStrategy: 'none' });
}

function inlineSchema(schema: z.ZodTypeAny, name: string): JsonObject {
  const generated = toJsonSchema(schema, name);
  const definitions = generated['definitions'] as JsonObject | undefined;
  const inlined = definitions?.[name];
  return (inlined as JsonObject) ?? generated;
}

function pathParameters(path: string): JsonObject[] {
  const matches = path.match(/\{([a-zA-Z0-9_]+)\}/g) ?? [];
  return matches.map((token) => ({
    name: token.slice(1, -1),
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' },
  }));
}

function queryParameters(route: RouteDefinition): JsonObject[] {
  if (route.query === undefined) return [];
  const schema = inlineSchema(route.query, `${route.operationId}Query`);
  const properties = (schema['properties'] as JsonObject | undefined) ?? {};
  const required = new Set((schema['required'] as string[] | undefined) ?? []);

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: property,
  }));
}

const PROBLEM_RESPONSE = {
  content: { 'application/problem+json': { schema: inlineSchema(problemDetailsSchema, 'Problem') } },
};

function buildOperation(route: RouteDefinition): JsonObject {
  const responses: JsonObject = {
    [String(route.successStatus ?? 200)]: {
      description: 'Success',
      content: {
        'application/json': { schema: inlineSchema(route.response, `${route.operationId}Response`) },
      },
    },
    '400': { description: 'Validation failed', ...PROBLEM_RESPONSE },
    '500': { description: 'Internal error', ...PROBLEM_RESPONSE },
  };

  if (route.permissions !== null) {
    responses['401'] = { description: 'Unauthenticated', ...PROBLEM_RESPONSE };
    responses['403'] = { description: 'Permission denied', ...PROBLEM_RESPONSE };
    responses['404'] = {
      // ทรัพยากรของ tenant อื่นตอบ 404 ไม่ใช่ 403 (ADR-0005)
      description: 'Not found, or not visible to the caller tenant',
      ...PROBLEM_RESPONSE,
    };
  }

  if (route.idempotent === true) {
    responses['409'] = { description: 'A request with this Idempotency-Key is in progress', ...PROBLEM_RESPONSE };
    responses['422'] = { description: 'Idempotency-Key reused with a different payload', ...PROBLEM_RESPONSE };
  }

  const parameters: JsonObject[] = [...pathParameters(route.path), ...queryParameters(route)];

  if (route.idempotent === true) {
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      description: 'UUID; การส่งซ้ำด้วยคีย์เดิมและ payload เดิมจะได้ผลลัพธ์เดิม (ADR-0008)',
      schema: { type: 'string', format: 'uuid' },
    });
  }

  const operation: JsonObject = {
    operationId: route.operationId,
    summary: route.summary,
    tags: [route.tag],
    parameters,
    responses,
  };

  if (route.permissions === null) {
    operation['security'] = [];
  } else {
    operation['security'] = [{ bearerAuth: [] }];
    operation['x-required-permissions'] = route.permissions;
  }

  if (route.body !== undefined) {
    operation['requestBody'] = {
      required: true,
      content: {
        'application/json': { schema: inlineSchema(route.body, `${route.operationId}Body`) },
      },
    };
  }

  return operation;
}

export function buildOpenApiDocument(version = '0.1.0'): JsonObject {
  const paths: JsonObject = {};

  for (const route of allRoutes()) {
    const fullPath = `${API_BASE_PATH}${route.path}`;
    const existing = (paths[fullPath] as JsonObject | undefined) ?? {};
    existing[route.method] = buildOperation(route);
    paths[fullPath] = existing;
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'Workforce Time-to-Pay API',
      version,
      description:
        'Time-to-pay platform: device and photo time capture, attendance calculation, ' +
        'leave/overtime/timesheet, payroll with deterministic calculation traces, and ' +
        'payslip/bank/export documents. See docs/adr for the decisions behind each boundary. ' +
        'Statutory rates live in versioned rule sets that cannot be published without sign-off ' +
        '(HR_ATTENDANCE_PAYROLL_REBUILD_SPEC_TH.md §9.5).',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'system', description: 'Health and readiness' },
      { name: 'identity', description: 'Caller identity and permissions' },
      { name: 'organization', description: 'Companies, org units, sites, positions' },
      { name: 'people', description: 'People and employments' },
      { name: 'compensation', description: 'Effective-dated compensation rates' },
      { name: 'devices', description: 'Device provisioning and biometric references' },
      {
        name: 'device-ingestion',
        description: 'Signed device boundary — authenticated by per-device key, no user session',
      },
      { name: 'checkin', description: 'Photo check-in sessions, evidence and risk review' },
      { name: 'attendance', description: 'Work policies, shifts, roster, results and corrections' },
      { name: 'workflow', description: 'Leave, overtime and timesheet periods' },
      { name: 'payroll', description: 'Pay items, rule sets, runs, snapshots and traces' },
      { name: 'documents', description: 'Payslips, bank batches and exports' },
      { name: 'audit', description: 'Append-only audit trail' },
    ],
    paths,
  };
}
