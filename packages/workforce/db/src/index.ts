export {
  clearTenantContext,
  createDatabaseFromUrl,
  createPgliteDatabase,
  createPostgresDatabase,
  setTenantContext,
  withSystemTransaction,
  withTenant,
  type DatabaseHandle,
  type DatabaseUrlOptions,
  type Db,
  type PgliteOptions,
  type PostgresOptions,
  type Tx,
} from './client';

export {
  defaultMigrationsDir,
  getAppliedMigrations,
  loadMigrations,
  migrate,
  MigrationChecksumError,
  verifyMigrations,
  type AppliedMigration,
  type MigrateResult,
  type MigrationFile,
} from './migrator';

export * as schema from './schema';
export { schemaTables, workforce } from './schema';

export {
  mapSmartbossRoles,
  provisionPrincipal,
  provisionTenant,
  SMARTBOSS_PERMISSION,
  type ProvisionPrincipalInput,
  type ProvisionPrincipalResult,
  type ProvisionTenantInput,
  type ProvisionTenantResult,
  type RoleMappingInput,
} from './provisioning/smartboss';

export { seedSystemRoles } from './seed/system-roles';
export { seedDemoTenant, type DemoSeedResult } from './seed/demo';

export { createTestDatabase, type TestDatabase } from './testing/harness';
