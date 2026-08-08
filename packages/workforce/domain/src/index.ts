export { isUuid, uuidv4, uuidv7, uuidv7Timestamp } from './id/uuid-v7';

export {
  DecimalPrecisionError,
  formatScaledToDecimal,
  parseDecimalToScaled,
  truncateExactDecimals,
} from './money/decimal-string';
export { CurrencyMismatchError, Money, MONEY_SCALE } from './money/money';
export { Rate, RATE_SCALE } from './money/rate';
export { divideWithRounding, pow10, ROUNDING_MODES, type RoundingMode } from './money/rounding';

export { DEFAULT_TIME_ZONE, FixedClock, SystemClock, type Clock } from './time/clock';
export {
  EffectivePeriod,
  findOverlap,
  InvalidEffectivePeriodError,
  resolveAsOf,
} from './time/effective-period';
export { InvalidDateError, LocalDate } from './time/local-date';
export {
  formatTimeOfDay,
  minutesFromMidnight,
  parseTimeOfDay,
  timeZoneOffsetMs,
  utcToZonedParts,
  zonedTimeToUtc,
  type ZonedParts,
} from './time/zoned-time';

export {
  isPermission,
  PERMISSIONS,
  requiresStepUp,
  scopeCovers,
  STEP_UP_PERMISSIONS,
  widestScope,
  type DataScope,
  type Permission,
} from './authz/permissions';
export { SYSTEM_ROLE_PERMISSIONS, SYSTEM_ROLES, type SystemRole } from './authz/roles';

export {
  actorDisplay,
  actorId,
  actorTenantId,
  type Actor,
  type AuthenticatedPrincipal,
  type DeviceIdentity,
} from './identity/principal';

export {
  REASON_REQUIRED_ACTIONS,
  requiresReason,
  type AuditActorType,
  type AuditEventInput,
  type AuditOutcome,
} from './audit/audit-event';

export { AppError, isAppError, type AppErrorCode, type AppErrorOptions } from './errors/app-error';

export {
  findSensitiveKeys,
  REDACTED,
  redactSensitive,
  type RedactOptions,
} from './privacy/redact';

export {
  assessClockDrift,
  assessOfflineAge,
  canonicalJson,
  computeEventPayloadHash,
  EVENT_INTENTS,
  isPayrollRelevantIntent,
  SOURCE_TYPES,
  type ClockDriftAssessment,
  type EventIntent,
  type OfflineAgeAssessment,
  type SourceType,
  type TimeEventEnvelope,
} from './time-events/event-envelope';

export {
  createsTimeEvent,
  distanceMeters,
  evaluateCheckin,
  impliedSpeedKmh,
  requiresReview,
  type CheckinDecision,
  type CheckinEvidence,
  type PhotoPolicy,
  type PolicyEvaluation,
  type RiskFlag,
  type SiteLocation,
} from './attendance/photo-policy';

export {
  buildSigningPayload,
  hashActivationToken,
  isRequestTimestampFresh,
  safeCompare,
  verifyDeviceSignature,
  type SignedRequest,
} from './devices/device-signature';
