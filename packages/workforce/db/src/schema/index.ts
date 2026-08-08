import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, bytea, inet, workforce } from './base';

/**
 * Drizzle table definitions — ต้องตรงกับ `migrations/*.sql` เสมอ
 *
 * SQL เป็น source of truth (ADR-0003); ไฟล์นี้คือมุมมองแบบ typed ของ schema เดียวกัน
 * `schema-invariants.test.ts` เทียบสองฝั่งกับ DB จริงเพื่อกัน drift
 */
export { auditColumns, bytea, inet, workforce } from './base';
export * from './devices';
export * from './photo';
export * from './attendance';
export * from './workflow';
export * from './payroll';
export * from './documents';
import { deviceTables } from './devices';
import { photoTables } from './photo';
import { attendanceTables } from './attendance';
import { workflowTables } from './workflow';
import { payrollTables } from './payroll';
import { documentTables } from './documents';

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export const tenants = workforce.table('tenants', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  defaultTimeZone: text('default_time_zone').notNull().default('Asia/Bangkok'),
  defaultCurrency: char('default_currency', { length: 3 }).notNull().default('THB'),
  ...auditColumns,
});

export const companies = workforce.table(
  'companies',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    code: text('code').notNull(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    taxIdEncrypted: bytea('tax_id_encrypted'),
    timeZone: text('time_zone').notNull().default('Asia/Bangkok'),
    currency: char('currency', { length: 3 }).notNull().default('THB'),
    status: text('status').notNull().default('ACTIVE'),
    ...auditColumns,
  },
  (table) => [index('companies_tenant_idx').on(table.tenantId)],
);

export const orgUnits = workforce.table(
  'org_units',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    parentId: uuid('parent_id'),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('DEPARTMENT'),
    status: text('status').notNull().default('ACTIVE'),
    ...auditColumns,
  },
  (table) => [index('org_units_parent_idx').on(table.tenantId, table.parentId)],
);

export const sites = workforce.table('sites', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  timeZone: text('time_zone').notNull().default('Asia/Bangkok'),
  latitude: numeric('latitude', { precision: 9, scale: 6 }),
  longitude: numeric('longitude', { precision: 9, scale: 6 }),
  radiusM: integer('radius_m'),
  status: text('status').notNull().default('ACTIVE'),
  ...auditColumns,
});

export const positions = workforce.table('positions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  ...auditColumns,
});

// ---------------------------------------------------------------------------
// People and employment
// ---------------------------------------------------------------------------

export const people = workforce.table(
  'people',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    preferredName: text('preferred_name').notNull().default(''),
    email: text('email'),
    phone: text('phone'),
    dateOfBirth: date('date_of_birth'),
    nationalIdEncrypted: bytea('national_id_encrypted'),
    nationalIdHash: bytea('national_id_hash'),
    status: text('status').notNull().default('ACTIVE'),
    ...auditColumns,
  },
  (table) => [index('people_tenant_idx').on(table.tenantId)],
);

export const employments = workforce.table(
  'employments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    personId: uuid('person_id').notNull(),
    employeeCode: text('employee_code').notNull(),
    employmentType: text('employment_type').notNull(),
    hiredOn: date('hired_on').notNull(),
    terminatedOn: date('terminated_on'),
    status: text('status').notNull().default('ACTIVE'),
    primarySiteId: uuid('primary_site_id'),
    timeZone: text('time_zone').notNull().default('Asia/Bangkok'),
    ...auditColumns,
  },
  (table) => [
    index('employments_person_idx').on(table.tenantId, table.personId),
    index('employments_company_status_idx').on(table.tenantId, table.companyId, table.status),
  ],
);

export const employmentAssignments = workforce.table(
  'employment_assignments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    orgUnitId: uuid('org_unit_id'),
    positionId: uuid('position_id'),
    managerEmploymentId: uuid('manager_employment_id'),
    siteId: uuid('site_id'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...auditColumns,
  },
  (table) => [
    index('employment_assignments_lookup_idx').on(
      table.tenantId,
      table.employmentId,
      table.effectiveFrom,
    ),
    index('employment_assignments_manager_idx').on(
      table.tenantId,
      table.managerEmploymentId,
      table.effectiveFrom,
    ),
  ],
);

export const compensationRates = workforce.table(
  'compensation_rates',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    payBasis: text('pay_basis').notNull(),
    // numeric(19,4) — driver คืนเป็น string, domain แปลงเป็น Money (ADR-0007)
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('THB'),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    provenance: text('provenance').notNull().default('MANUAL'),
    approvalReference: text('approval_reference'),
    note: text('note').notNull().default(''),
    ...auditColumns,
  },
  (table) => [
    index('compensation_rates_lookup_idx').on(
      table.tenantId,
      table.employmentId,
      table.effectiveFrom,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Identity and RBAC
// ---------------------------------------------------------------------------

export const principals = workforce.table(
  'principals',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    subject: text('subject').notNull(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    personId: uuid('person_id'),
    status: text('status').notNull().default('ACTIVE'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    uniqueIndex('principals_tenant_subject_key').on(table.tenantId, table.subject),
    index('principals_person_idx').on(table.tenantId, table.personId),
  ],
);

export const roles = workforce.table('roles', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  description: text('description').notNull().default(''),
  ...auditColumns,
});

export const rolePermissions = workforce.table(
  'role_permissions',
  {
    tenantId: uuid('tenant_id').notNull(),
    roleId: uuid('role_id').notNull(),
    permission: text('permission').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [index('role_permissions_tenant_idx').on(table.tenantId)],
);

export const principalRoleAssignments = workforce.table(
  'principal_role_assignments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    principalId: uuid('principal_id').notNull(),
    roleId: uuid('role_id').notNull(),
    companyId: uuid('company_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    reason: text('reason').notNull().default(''),
    grantedBy: uuid('granted_by'),
    ...auditColumns,
  },
  (table) => [
    index('principal_role_assignments_principal_idx').on(table.tenantId, table.principalId),
  ],
);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const auditEvents = workforce.table(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    actorDisplay: text('actor_display').notNull().default(''),
    onBehalfOfId: uuid('on_behalf_of_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    resourceVersion: integer('resource_version'),
    outcome: text('outcome').notNull(),
    reason: text('reason'),
    requestId: text('request_id'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    before: jsonb('before'),
    after: jsonb('after'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => [
    index('audit_events_tenant_time_idx').on(table.tenantId, table.occurredAt),
    index('audit_events_action_idx').on(table.tenantId, table.action, table.occurredAt),
  ],
);

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

export const idempotencyKeys = workforce.table(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    principalId: uuid('principal_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').notNull().default('IN_PROGRESS'),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex('idempotency_keys_key').on(table.tenantId, table.idempotencyKey)],
);

export const outboxMessages = workforce.table('outbox_messages', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id'),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  headers: jsonb('headers').notNull().default({}),
  status: text('status').notNull().default('PENDING'),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(10),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
  lastError: text('last_error'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
});

export const inboxMessages = workforce.table('inbox_messages', {
  messageId: text('message_id').primaryKey(),
  tenantId: uuid('tenant_id'),
  source: text('source').notNull(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  result: text('result').notNull().default('PROCESSED'),
});

export const jobs = workforce.table('jobs', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id'),
  jobType: text('job_type').notNull(),
  payload: jsonb('payload').notNull().default({}),
  status: text('status').notNull().default('QUEUED'),
  progress: integer('progress').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  result: jsonb('result'),
  error: text('error'),
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid('created_by'),
});

export const storageObjects = workforce.table(
  'storage_objects',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id'),
    category: text('category').notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: bytea('sha256').notNull(),
    status: text('status').notNull().default('QUARANTINE'),
    retentionUntil: date('retention_until'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    uniqueIndex('storage_objects_key_unique').on(table.objectKey),
    index('storage_objects_sha_idx').on(table.tenantId, table.sha256),
  ],
);

export const schemaTables = {
  ...deviceTables,
  ...photoTables,
  ...attendanceTables,
  ...workflowTables,
  ...payrollTables,
  ...documentTables,
  tenants,
  companies,
  orgUnits,
  sites,
  positions,
  people,
  employments,
  employmentAssignments,
  compensationRates,
  principals,
  roles,
  rolePermissions,
  principalRoleAssignments,
  auditEvents,
  idempotencyKeys,
  outboxMessages,
  inboxMessages,
  jobs,
  storageObjects,
};
