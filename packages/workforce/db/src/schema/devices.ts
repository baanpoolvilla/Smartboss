import { bigint, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, bytea, workforce } from './base';

export const devices = workforce.table(
  'devices',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    deviceCode: text('device_code').notNull(),
    name: text('name').notNull().default(''),
    siteId: uuid('site_id'),
    deviceType: text('device_type').notNull().default('FINGERPRINT_TERMINAL'),
    status: text('status').notNull().default('PENDING'),
    timeZone: text('time_zone').notNull().default('Asia/Bangkok'),
    firmwareVersion: text('firmware_version'),
    configVersion: integer('config_version').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [index('devices_status_idx').on(table.tenantId, table.status)],
);

export const deviceCredentials = workforce.table(
  'device_credentials',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    publicKey: bytea('public_key').notNull(),
    algorithm: text('algorithm').notNull().default('ed25519'),
    status: text('status').notNull().default('ACTIVE'),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [index('device_credentials_device_idx').on(table.tenantId, table.deviceId)],
);

export const deviceActivationTokens = workforce.table(
  'device_activation_tokens',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    tokenHash: bytea('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [uniqueIndex('device_activation_tokens_hash_key').on(table.tokenHash)],
);

export const deviceHeartbeats = workforce.table(
  'device_heartbeats',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    clockDriftMs: bigint('clock_drift_ms', { mode: 'number' }).notNull().default(0),
    queueDepth: integer('queue_depth').notNull().default(0),
    templateCount: integer('template_count').notNull().default(0),
    firmwareVersion: text('firmware_version'),
    configVersion: integer('config_version'),
    metrics: jsonb('metrics').notNull().default({}),
  },
  (table) => [
    index('device_heartbeats_device_time_idx').on(table.tenantId, table.deviceId, table.reportedAt),
  ],
);

export const deviceCommands = workforce.table(
  'device_commands',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    commandType: text('command_type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    nonce: bytea('nonce').notNull(),
    status: text('status').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    result: jsonb('result'),
    requestedBy: uuid('requested_by'),
    reason: text('reason').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('device_commands_pending_idx').on(
      table.tenantId,
      table.deviceId,
      table.status,
      table.createdAt,
    ),
  ],
);

export const biometricEnrollments = workforce.table(
  'biometric_enrollments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    templateSlot: integer('template_slot').notNull(),
    // hash เท่านั้น — ไม่มีคอลัมน์ไหนเก็บ template หรือภาพลายนิ้วมือ (spec §6.2)
    templateHash: bytea('template_hash'),
    templateVersion: integer('template_version').notNull().default(1),
    quality: integer('quality'),
    fingerPosition: text('finger_position'),
    status: text('status').notNull().default('ACTIVE'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (table) => [
    index('biometric_enrollments_employment_idx').on(
      table.tenantId,
      table.employmentId,
      table.status,
    ),
  ],
);

export const biometricDeletionJobs = workforce.table(
  'biometric_deletion_jobs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    deviceId: uuid('device_id').notNull(),
    enrollmentId: uuid('enrollment_id'),
    commandId: uuid('command_id'),
    status: text('status').notNull().default('PENDING'),
    reason: text('reason').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  (table) => [
    index('biometric_deletion_jobs_status_idx').on(
      table.tenantId,
      table.status,
      table.requestedAt,
    ),
  ],
);

export const rawTimeEvents = workforce.table(
  'raw_time_events',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    employmentId: uuid('employment_id'),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    eventIntent: text('event_intent').notNull().default('AUTO'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    timeZone: text('time_zone').notNull().default('Asia/Bangkok'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    sequence: bigint('sequence', { mode: 'number' }),
    payloadHash: bytea('payload_hash').notNull(),
    evidence: jsonb('evidence').notNull().default({}),
    clientContext: jsonb('client_context').notNull().default({}),
    signature: bytea('signature'),
    status: text('status').notNull().default('ACCEPTED'),
    quarantineReason: text('quarantine_reason'),
    ingestBatchId: uuid('ingest_batch_id'),
  },
  (table) => [
    index('raw_time_events_employment_time_idx').on(
      table.tenantId,
      table.employmentId,
      table.capturedAt,
    ),
    index('raw_time_events_company_time_idx').on(
      table.tenantId,
      table.companyId,
      table.capturedAt,
    ),
  ],
);

export const rawTimeEventQuarantine = workforce.table('raw_time_event_quarantine', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id'),
  sequence: bigint('sequence', { mode: 'number' }),
  claimedEventId: uuid('claimed_event_id'),
  existingEventId: uuid('existing_event_id'),
  reason: text('reason').notNull(),
  payload: jsonb('payload').notNull(),
  payloadHash: bytea('payload_hash').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: uuid('reviewed_by'),
  resolution: text('resolution'),
});

export const deviceIngestBatches = workforce.table('device_ingest_batches', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  deviceId: uuid('device_id').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  eventCount: integer('event_count').notNull().default(0),
  acceptedCount: integer('accepted_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
  quarantinedCount: integer('quarantined_count').notNull().default(0),
  minSequence: bigint('min_sequence', { mode: 'number' }),
  maxSequence: bigint('max_sequence', { mode: 'number' }),
  ackedSequence: bigint('acked_sequence', { mode: 'number' }),
  clockDriftMs: bigint('clock_drift_ms', { mode: 'number' }).notNull().default(0),
});

export const deviceTables = {
  devices,
  deviceCredentials,
  deviceActivationTokens,
  deviceHeartbeats,
  deviceCommands,
  biometricEnrollments,
  biometricDeletionJobs,
  rawTimeEvents,
  rawTimeEventQuarantine,
  deviceIngestBatches,
};
