/**
 * Policy engine ของ Photo Check-in (spec §6.3, §6.4)
 *
 * เป็น pure function โดยเจตนา: การตัดสินใจว่ารับ/เตือน/ส่งตรวจ/ปฏิเสธ เป็นกฎธุรกิจ
 * ที่ต้องอธิบายได้และทดสอบได้โดยไม่ต้องมี DB, กล้อง หรือ GPS จริง
 */

export type CheckinDecision =
  | 'ACCEPTED'
  | 'ACCEPTED_WITH_WARNING'
  | 'PENDING_REVIEW'
  | 'REJECTED_POLICY';

export type RiskFlag =
  | 'LOCATION_MISSING'
  | 'LOCATION_OUTSIDE_RADIUS'
  | 'LOCATION_ACCURACY_POOR'
  | 'MOCK_LOCATION_SUSPECTED'
  | 'PHOTO_MISSING'
  | 'PHOTO_NOT_LIVE_CAPTURE'
  | 'PHOTO_DUPLICATE'
  | 'DEVICE_NOT_ENROLLED'
  | 'DEVICE_ATTESTATION_FAILED'
  | 'CAPTURE_DEADLINE_EXCEEDED'
  | 'OFFLINE_TOO_OLD'
  | 'IMPOSSIBLE_TRAVEL'
  | 'RAPID_REPEAT_CHECKIN'
  | 'CLOCK_SKEW';

export interface PhotoPolicy {
  photoRequired: 'ALWAYS' | 'RANDOM' | 'RISK_BASED' | 'DISABLED';
  photoRandomPercent: number;
  locationRequired: boolean;
  allowedSiteIds: readonly string[];
  radiusM: number;
  maxAccuracyM: number;
  captureDeadlineSeconds: number;
  allowOfflineCapture: boolean;
  offlineMaxAgeMinutes: number;
  requireEnrolledDevice: boolean;
  requireLiveCapture: boolean;
  riskAction: 'WARN' | 'REVIEW' | 'REJECT';
}

export interface CheckinEvidence {
  hasPhoto: boolean;
  liveCapture: boolean;
  /** true = checksum ของรูปตรงกับรูปที่เคยส่งมาก่อน */
  duplicatePhoto: boolean;
  location: { latitude: number; longitude: number; accuracyM: number } | null;
  mockLocationSuspected: boolean;
  deviceEnrolled: boolean;
  attestationStatus: 'VERIFIED' | 'FAILED' | 'UNAVAILABLE';
  capturedAtClient: Date;
  committedAt: Date;
  /** ระยะทาง/เวลาจากการลงเวลาครั้งก่อน — ใช้ตรวจ impossible travel */
  previousCheckin: { at: Date; latitude: number; longitude: number } | null;
}

export interface SiteLocation {
  id: string;
  latitude: number;
  longitude: number;
  radiusM: number | null;
}

export interface PolicyEvaluation {
  decision: CheckinDecision;
  flags: RiskFlag[];
  score: number;
  matchedSiteId: string | null;
  distanceFromSiteM: number | null;
  /** อธิบายเหตุผลของแต่ละ flag ให้ผู้ตรวจอ่านได้ */
  details: Record<string, unknown>;
}

/** น้ำหนักความเสี่ยงของแต่ละ flag — รวมกันเป็นคะแนน 0..100 */
const FLAG_WEIGHTS: Record<RiskFlag, number> = {
  LOCATION_MISSING: 25,
  LOCATION_OUTSIDE_RADIUS: 30,
  LOCATION_ACCURACY_POOR: 15,
  MOCK_LOCATION_SUSPECTED: 60,
  PHOTO_MISSING: 25,
  PHOTO_NOT_LIVE_CAPTURE: 35,
  PHOTO_DUPLICATE: 55,
  DEVICE_NOT_ENROLLED: 40,
  DEVICE_ATTESTATION_FAILED: 45,
  CAPTURE_DEADLINE_EXCEEDED: 20,
  OFFLINE_TOO_OLD: 30,
  IMPOSSIBLE_TRAVEL: 50,
  RAPID_REPEAT_CHECKIN: 20,
  CLOCK_SKEW: 15,
};

/** flag ที่ร้ายแรงพอจะปฏิเสธได้เมื่อ policy ตั้งไว้เป็น REJECT */
const HARD_FLAGS: ReadonlySet<RiskFlag> = new Set<RiskFlag>([
  'MOCK_LOCATION_SUSPECTED',
  'PHOTO_DUPLICATE',
  'PHOTO_NOT_LIVE_CAPTURE',
  'DEVICE_NOT_ENROLLED',
  'DEVICE_ATTESTATION_FAILED',
  'LOCATION_OUTSIDE_RADIUS',
]);

const EARTH_RADIUS_M = 6_371_000;

/** ระยะทางระหว่างสองพิกัดด้วยสูตร haversine (เมตร) */
export function distanceMeters(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLng = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * ความเร็วที่ต้องใช้เพื่อเดินทางระหว่างสองจุดในเวลาที่ผ่านไป (กม./ชม.)
 * เกินความเร็วของเครื่องบินพาณิชย์ = เป็นไปไม่ได้ทางกายภาพ
 */
export function impliedSpeedKmh(
  from: { at: Date; latitude: number; longitude: number },
  to: { at: Date; latitude: number; longitude: number },
): number {
  const seconds = Math.abs(to.at.getTime() - from.at.getTime()) / 1000;
  if (seconds <= 0) return Number.POSITIVE_INFINITY;
  return distanceMeters(from, to) / seconds * 3.6;
}

const IMPOSSIBLE_TRAVEL_KMH = 900;
const RAPID_REPEAT_SECONDS = 60;

export function evaluateCheckin(input: {
  policy: PhotoPolicy;
  evidence: CheckinEvidence;
  sites: readonly SiteLocation[];
  /** true = policy สุ่มแล้วรอบนี้ต้องมีรูป (ตัดสินนอกฟังก์ชันเพื่อให้ deterministic) */
  photoSampled?: boolean;
}): PolicyEvaluation {
  const { policy, evidence, sites } = input;
  const flags: RiskFlag[] = [];
  const details: Record<string, unknown> = {};

  // --- location ---
  let matchedSiteId: string | null = null;
  let distanceFromSiteM: number | null = null;

  if (evidence.location === null) {
    if (policy.locationRequired) flags.push('LOCATION_MISSING');
  } else {
    if (evidence.location.accuracyM > policy.maxAccuracyM) {
      flags.push('LOCATION_ACCURACY_POOR');
      details['accuracy_m'] = evidence.location.accuracyM;
      details['max_accuracy_m'] = policy.maxAccuracyM;
    }

    const candidates =
      policy.allowedSiteIds.length === 0
        ? sites
        : sites.filter((site) => policy.allowedSiteIds.includes(site.id));

    let nearest: { site: SiteLocation; distance: number } | null = null;
    for (const site of candidates) {
      const distance = distanceMeters(evidence.location, site);
      if (nearest === null || distance < nearest.distance) nearest = { site, distance };
    }

    if (nearest !== null) {
      matchedSiteId = nearest.site.id;
      distanceFromSiteM = Math.round(nearest.distance * 100) / 100;
      const allowedRadius = nearest.site.radiusM ?? policy.radiusM;
      details['distance_from_site_m'] = distanceFromSiteM;
      details['allowed_radius_m'] = allowedRadius;

      // รัศมีที่ยอมรับต้องเผื่อความคลาดเคลื่อนของ GPS ด้วย มิฉะนั้นคนที่ยืนอยู่
      // หน้าประตูจริงแต่สัญญาณไม่ดีจะถูกตั้งข้อสงสัยทุกวัน
      if (nearest.distance > allowedRadius + evidence.location.accuracyM) {
        flags.push('LOCATION_OUTSIDE_RADIUS');
      }
    } else if (policy.locationRequired) {
      flags.push('LOCATION_MISSING');
      details['reason'] = 'no site configured for this policy group';
    }

    if (evidence.mockLocationSuspected) flags.push('MOCK_LOCATION_SUSPECTED');
  }

  // --- photo ---
  const photoNeeded =
    policy.photoRequired === 'ALWAYS' ||
    (policy.photoRequired === 'RANDOM' && input.photoSampled === true) ||
    (policy.photoRequired === 'RISK_BASED' && flags.length > 0);

  if (photoNeeded && !evidence.hasPhoto) flags.push('PHOTO_MISSING');
  if (evidence.hasPhoto) {
    if (policy.requireLiveCapture && !evidence.liveCapture) flags.push('PHOTO_NOT_LIVE_CAPTURE');
    if (evidence.duplicatePhoto) flags.push('PHOTO_DUPLICATE');
  }

  // --- device ---
  if (policy.requireEnrolledDevice && !evidence.deviceEnrolled) flags.push('DEVICE_NOT_ENROLLED');
  if (evidence.attestationStatus === 'FAILED') flags.push('DEVICE_ATTESTATION_FAILED');

  // --- timing ---
  const captureAgeSeconds =
    (evidence.committedAt.getTime() - evidence.capturedAtClient.getTime()) / 1000;
  details['capture_age_seconds'] = Math.round(captureAgeSeconds);

  if (captureAgeSeconds < 0) {
    // เวลาที่เครื่องอ้างอยู่ในอนาคต — นาฬิกาเพี้ยนหรือถูกแก้
    flags.push('CLOCK_SKEW');
  } else if (captureAgeSeconds > policy.captureDeadlineSeconds) {
    if (policy.allowOfflineCapture) {
      if (captureAgeSeconds > policy.offlineMaxAgeMinutes * 60) flags.push('OFFLINE_TOO_OLD');
    } else {
      flags.push('CAPTURE_DEADLINE_EXCEEDED');
    }
  }

  // --- movement ---
  if (evidence.previousCheckin !== null && evidence.location !== null) {
    const speed = impliedSpeedKmh(evidence.previousCheckin, {
      at: evidence.capturedAtClient,
      latitude: evidence.location.latitude,
      longitude: evidence.location.longitude,
    });
    details['implied_speed_kmh'] = Number.isFinite(speed) ? Math.round(speed) : null;

    const secondsSincePrevious =
      (evidence.capturedAtClient.getTime() - evidence.previousCheckin.at.getTime()) / 1000;

    if (secondsSincePrevious >= 0 && secondsSincePrevious < RAPID_REPEAT_SECONDS) {
      flags.push('RAPID_REPEAT_CHECKIN');
    } else if (speed > IMPOSSIBLE_TRAVEL_KMH) {
      flags.push('IMPOSSIBLE_TRAVEL');
    }
  }

  const score = Math.min(
    100,
    flags.reduce((total, flag) => total + FLAG_WEIGHTS[flag], 0),
  );

  return {
    decision: decide(flags, policy.riskAction),
    flags,
    score,
    matchedSiteId,
    distanceFromSiteM,
    details,
  };
}

/**
 * แปลง flag เป็นการตัดสินใจ
 *
 * spec §6.4: "ไม่ปฏิเสธแบบมืดมน — รายการเสี่ยงเข้า review queue"
 * แม้ policy ตั้งเป็น REJECT ก็ปฏิเสธเฉพาะ flag ที่ร้ายแรงจริง flag เบา ๆ
 * ยังเข้าคิวตรวจ เพื่อไม่ให้คนที่มาทำงานจริงลงเวลาไม่ได้เพราะ GPS แกว่ง
 */
function decide(flags: readonly RiskFlag[], riskAction: PhotoPolicy['riskAction']): CheckinDecision {
  if (flags.length === 0) return 'ACCEPTED';

  const hasHardFlag = flags.some((flag) => HARD_FLAGS.has(flag));

  switch (riskAction) {
    case 'WARN':
      return 'ACCEPTED_WITH_WARNING';
    case 'REVIEW':
      return 'PENDING_REVIEW';
    case 'REJECT':
      return hasHardFlag ? 'REJECTED_POLICY' : 'PENDING_REVIEW';
  }
}

/** เหตุการณ์ที่ถูกปฏิเสธจะไม่กลายเป็นเวลาทำงาน แต่ยังต้องเก็บเป็นหลักฐาน */
export function createsTimeEvent(decision: CheckinDecision): boolean {
  return decision !== 'REJECTED_POLICY';
}

/** เหตุการณ์ที่ต้องมีคนตรวจก่อนจึงจะนับเป็นเวลาทำงาน */
export function requiresReview(decision: CheckinDecision): boolean {
  return decision === 'PENDING_REVIEW';
}
