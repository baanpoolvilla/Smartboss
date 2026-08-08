import { char, date, index, integer, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { auditColumns, bytea, inet, workforce } from './base';

export const payslipDocuments = workforce.table(
  'payslip_documents',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    runId: uuid('run_id').notNull(),
    resultId: uuid('result_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    documentVersion: integer('document_version').notNull().default(1),
    storageObjectId: uuid('storage_object_id'),
    gross: numeric('gross', { precision: 19, scale: 4 }).notNull(),
    totalDeduction: numeric('total_deduction', { precision: 19, scale: 4 }).notNull(),
    netPay: numeric('net_pay', { precision: 19, scale: 4 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('THB'),
    contentHash: bytea('content_hash').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payslip_documents_version_key').on(table.resultId, table.documentVersion),
    index('payslip_documents_employment_idx').on(
      table.tenantId,
      table.employmentId,
      table.publishedAt,
    ),
  ],
);

export const payslipAccessLog = workforce.table(
  'payslip_access_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    payslipId: uuid('payslip_id').notNull(),
    principalId: uuid('principal_id'),
    accessedAt: timestamp('accessed_at', { withTimezone: true }).notNull().defaultNow(),
    ip: inet('ip'),
    purpose: text('purpose').notNull().default('DOWNLOAD'),
  },
  (table) => [
    index('payslip_access_log_payslip_idx').on(table.tenantId, table.payslipId, table.accessedAt),
  ],
);

export const bankProfiles = workforce.table('bank_profiles', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  bankCode: text('bank_code').notNull(),
  accountNumberEncrypted: bytea('account_number_encrypted'),
  fileFormat: text('file_format').notNull().default('CSV'),
  status: text('status').notNull().default('ACTIVE'),
  ...auditColumns,
});

export const bankBatches = workforce.table(
  'bank_batches',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    runId: uuid('run_id').notNull(),
    bankProfileId: uuid('bank_profile_id').notNull(),
    valueDate: date('value_date').notNull(),
    controlCount: integer('control_count').notNull().default(0),
    controlTotal: numeric('control_total', { precision: 19, scale: 4 }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('THB'),
    status: text('status').notNull().default('DRAFT'),
    storageObjectId: uuid('storage_object_id'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    ...auditColumns,
  },
  (table) => [index('bank_batches_run_idx').on(table.tenantId, table.runId)],
);

export const bankBatchItems = workforce.table(
  'bank_batch_items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    employmentId: uuid('employment_id').notNull(),
    resultId: uuid('result_id').notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 }).notNull(),
    accountNumberEncrypted: bytea('account_number_encrypted'),
    accountLast4: text('account_last4'),
    reference: text('reference').notNull().default(''),
    status: text('status').notNull().default('PENDING'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('bank_batch_items_key').on(table.batchId, table.resultId)],
);

export const exportProfiles = workforce.table('export_profiles', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  exportType: text('export_type').notNull(),
  fileFormat: text('file_format').notNull().default('CSV'),
  columns: text('columns').array().notNull(),
  options: jsonb('options').notNull().default({}),
  status: text('status').notNull().default('ACTIVE'),
  ...auditColumns,
});

export const exportJobs = workforce.table(
  'export_jobs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id').notNull(),
    profileId: uuid('profile_id'),
    exportType: text('export_type').notNull(),
    runId: uuid('run_id'),
    parameters: jsonb('parameters').notNull().default({}),
    status: text('status').notNull().default('QUEUED'),
    rowCount: integer('row_count').notNull().default(0),
    storageObjectId: uuid('storage_object_id'),
    contentHash: bytea('content_hash'),
    error: text('error'),
    requestedBy: uuid('requested_by'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('export_jobs_lookup_idx').on(
      table.tenantId,
      table.companyId,
      table.exportType,
      table.createdAt,
    ),
  ],
);

export const documentTables = {
  payslipDocuments,
  payslipAccessLog,
  bankProfiles,
  bankBatches,
  bankBatchItems,
  exportProfiles,
  exportJobs,
};
