import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditColumns, bytea, workforce } from './base';

export const attendancePolicyGroups = workforce.table(
  'attendance_policy_groups',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    allowedMethods: text('allowed_methods').array().notNull(),
    photoRequired: text('photo_required').notNull().default('DISABLED'),
    photoRandomPercent: integer('photo_random_percent').notNull().default(0),
    locationRequired: boolean('location_required').notNull().default(true),
    allowedSiteIds: uuid('allowed_site_ids').array().notNull(),
    radiusM: integer('radius_m').notNull().default(200),
    maxAccuracyM: integer('max_accuracy_m').notNull().default(100),
    captureDeadlineSeconds: integer('capture_deadline_seconds').notNull().default(30),
    allowOfflineCapture: boolean('allow_offline_capture').notNull().default(false),
    offlineMaxAgeMinutes: integer('offline_max_age_minutes').notNull().default(120),
    requireEnrolledDevice: boolean('require_enrolled_device').notNull().default(true),
    riskAction: text('risk_action').notNull().default('REVIEW'),
    photoRetentionDays: integer('photo_retention_days').notNull().default(90),
    requireLiveCapture: boolean('require_live_capture').notNull().default(true),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...auditColumns,
  },
  (table) => [
    index('attendance_policy_groups_lookup_idx').on(
      table.tenantId,
      table.companyId,
      table.effectiveFrom,
    ),
  ],
);

export const attendancePolicyGroupMembers = workforce.table(
  'attendance_policy_group_members',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    policyGroupId: uuid('policy_group_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    ...auditColumns,
  },
  (table) => [
    index('attendance_policy_group_members_lookup_idx').on(
      table.tenantId,
      table.employmentId,
      table.effectiveFrom,
    ),
  ],
);

export const mobileDeviceRegistrations = workforce.table(
  'mobile_device_registrations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    deviceFingerprint: text('device_fingerprint').notNull(),
    platform: text('platform').notNull(),
    model: text('model'),
    appVersion: text('app_version'),
    attestationStatus: text('attestation_status').notNull().default('UNAVAILABLE'),
    status: text('status').notNull().default('PENDING'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [
    index('mobile_device_registrations_employment_idx').on(
      table.tenantId,
      table.employmentId,
      table.status,
    ),
  ],
);

export const photoCheckinSessions = workforce.table(
  'photo_checkin_sessions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    mobileDeviceRegistrationId: uuid('mobile_device_registration_id'),
    eventIntent: text('event_intent').notNull().default('AUTO'),
    status: text('status').notNull().default('OPEN'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    committedEventId: uuid('committed_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (table) => [
    index('photo_checkin_sessions_employment_idx').on(
      table.tenantId,
      table.employmentId,
      table.createdAt,
    ),
  ],
);

export const photoEvidenceObjects = workforce.table(
  'photo_evidence_objects',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    sessionId: uuid('session_id'),
    storageObjectId: uuid('storage_object_id').notNull(),
    sha256: bytea('sha256').notNull(),
    capturedAtClient: timestamp('captured_at_client', { withTimezone: true }).notNull(),
    uploadedAtServer: timestamp('uploaded_at_server', { withTimezone: true }).notNull().defaultNow(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    liveCapture: boolean('live_capture').notNull().default(true),
    retentionUntil: date('retention_until').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('photo_evidence_objects_sha_idx').on(table.tenantId, table.sha256)],
);

export const timeEventEvidence = workforce.table(
  'time_event_evidence',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    rawTimeEventId: uuid('raw_time_event_id'),
    sessionId: uuid('session_id'),
    photoEvidenceId: uuid('photo_evidence_id'),
    latitude: numeric('latitude', { precision: 9, scale: 6 }),
    longitude: numeric('longitude', { precision: 9, scale: 6 }),
    accuracyM: numeric('accuracy_m', { precision: 9, scale: 2 }),
    siteId: uuid('site_id'),
    distanceFromSiteM: numeric('distance_from_site_m', { precision: 12, scale: 2 }),
    platform: text('platform'),
    appVersion: text('app_version'),
    attestationStatus: text('attestation_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('time_event_evidence_event_idx').on(table.tenantId, table.rawTimeEventId)],
);

export const mobileRiskAssessments = workforce.table(
  'mobile_risk_assessments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    sessionId: uuid('session_id'),
    rawTimeEventId: uuid('raw_time_event_id'),
    employmentId: uuid('employment_id').notNull(),
    decision: text('decision').notNull(),
    riskFlags: text('risk_flags').array().notNull(),
    score: integer('score').notNull().default(0),
    policyGroupId: uuid('policy_group_id'),
    details: jsonb('details').notNull().default({}),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: uuid('reviewed_by'),
    reviewOutcome: text('review_outcome'),
    reviewReason: text('review_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mobile_risk_assessments_employment_idx').on(
      table.tenantId,
      table.employmentId,
      table.createdAt,
    ),
  ],
);

export const photoTables = {
  attendancePolicyGroups,
  attendancePolicyGroupMembers,
  mobileDeviceRegistrations,
  photoCheckinSessions,
  photoEvidenceObjects,
  timeEventEvidence,
  mobileRiskAssessments,
};
