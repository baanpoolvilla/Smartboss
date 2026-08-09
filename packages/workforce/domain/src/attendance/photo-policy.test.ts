import { describe, expect, it } from 'vitest';
import {
  createsTimeEvent,
  distanceMeters,
  evaluateCheckin,
  impliedSpeedKmh,
  requiresReview,
  type CheckinEvidence,
  type PhotoPolicy,
  type SiteLocation,
} from './photo-policy';

const HQ: SiteLocation = { id: 'site-hq', latitude: 12.9231, longitude: 100.8826, radiusM: 150 };

const strictPolicy: PhotoPolicy = {
  photoRequired: 'ALWAYS',
  photoRandomPercent: 0,
  locationRequired: true,
  allowedSiteIds: ['site-hq'],
  radiusM: 150,
  maxAccuracyM: 50,
  captureDeadlineSeconds: 30,
  allowOfflineCapture: false,
  offlineMaxAgeMinutes: 120,
  requireEnrolledDevice: true,
  requireLiveCapture: true,
  riskAction: 'REVIEW',
};

const capturedAt = new Date('2026-08-01T01:00:00.000Z');

const cleanEvidence: CheckinEvidence = {
  hasPhoto: true,
  liveCapture: true,
  duplicatePhoto: false,
  location: { latitude: 12.9231, longitude: 100.8826, accuracyM: 8 },
  mockLocationSuspected: false,
  deviceEnrolled: true,
  attestationStatus: 'UNAVAILABLE',
  capturedAtClient: capturedAt,
  committedAt: new Date(capturedAt.getTime() + 10_000),
  previousCheckin: null,
};

function evaluate(
  evidence: Partial<CheckinEvidence> = {},
  policy: Partial<PhotoPolicy> = {},
): ReturnType<typeof evaluateCheckin> {
  return evaluateCheckin({
    policy: { ...strictPolicy, ...policy },
    evidence: { ...cleanEvidence, ...evidence },
    sites: [HQ],
  });
}

describe('distanceMeters', () => {
  it('returns zero for the same point', () => {
    expect(distanceMeters(HQ, HQ)).toBe(0);
  });

  it('matches a known distance within a small tolerance', () => {
    // 0.001 องศาละติจูด ≈ 111 เมตร
    const distance = distanceMeters(
      { latitude: 12.9231, longitude: 100.8826 },
      { latitude: 12.9241, longitude: 100.8826 },
    );
    expect(distance).toBeGreaterThan(105);
    expect(distance).toBeLessThan(118);
  });
});

describe('impliedSpeedKmh', () => {
  it('flags travel that is physically impossible', () => {
    // กรุงเทพ → เชียงใหม่ ในห้านาที
    const speed = impliedSpeedKmh(
      { at: new Date('2026-08-01T00:00:00Z'), latitude: 13.7563, longitude: 100.5018 },
      { at: new Date('2026-08-01T00:05:00Z'), latitude: 18.7883, longitude: 98.9853 },
    );
    expect(speed).toBeGreaterThan(900);
  });

  it('treats a zero interval as infinite speed rather than dividing by zero', () => {
    const at = new Date('2026-08-01T00:00:00Z');
    expect(
      impliedSpeedKmh(
        { at, latitude: 13, longitude: 100 },
        { at, latitude: 14, longitude: 101 },
      ),
    ).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('evaluateCheckin — accepted path', () => {
  it('accepts a clean check-in at the site', () => {
    const result = evaluate();
    expect(result.decision).toBe('ACCEPTED');
    expect(result.flags).toEqual([]);
    expect(result.score).toBe(0);
    expect(result.matchedSiteId).toBe('site-hq');
    expect(result.distanceFromSiteM).toBe(0);
    expect(createsTimeEvent(result.decision)).toBe(true);
    expect(requiresReview(result.decision)).toBe(false);
  });

  it('tolerates GPS drift within the accuracy margin', () => {
    // อยู่นอกรัศมี 20 เมตร แต่ความคลาดเคลื่อนของ GPS คือ 40 เมตร
    // คนที่ยืนหน้าประตูจริงต้องไม่ถูกตั้งข้อสงสัยทุกวัน
    const result = evaluate({
      location: { latitude: 12.92463, longitude: 100.8826, accuracyM: 40 },
    });
    expect(result.flags).not.toContain('LOCATION_OUTSIDE_RADIUS');
  });
});

describe('evaluateCheckin — location risk', () => {
  it('flags a check-in far outside the radius', () => {
    const result = evaluate({
      location: { latitude: 13.7563, longitude: 100.5018, accuracyM: 10 },
    });
    expect(result.flags).toContain('LOCATION_OUTSIDE_RADIUS');
    expect(result.decision).toBe('PENDING_REVIEW');
    expect(result.details['distance_from_site_m']).toBeGreaterThan(90_000);
  });

  it('flags poor accuracy', () => {
    const result = evaluate({
      location: { latitude: 12.9231, longitude: 100.8826, accuracyM: 500 },
    });
    expect(result.flags).toContain('LOCATION_ACCURACY_POOR');
  });

  it('flags missing location when the policy requires it', () => {
    expect(evaluate({ location: null }).flags).toContain('LOCATION_MISSING');
  });

  it('does not flag missing location when the policy does not require it', () => {
    const result = evaluate({ location: null }, { locationRequired: false });
    expect(result.flags).not.toContain('LOCATION_MISSING');
  });

  it('treats suspected mock location as a hard flag', () => {
    const result = evaluate({ mockLocationSuspected: true }, { riskAction: 'REJECT' });
    expect(result.flags).toContain('MOCK_LOCATION_SUSPECTED');
    expect(result.decision).toBe('REJECTED_POLICY');
    expect(createsTimeEvent(result.decision)).toBe(false);
  });
});

describe('evaluateCheckin — photo risk', () => {
  it('requires a photo when the policy says always', () => {
    expect(evaluate({ hasPhoto: false }).flags).toContain('PHOTO_MISSING');
  });

  it('does not require a photo when disabled', () => {
    const result = evaluate({ hasPhoto: false }, { photoRequired: 'DISABLED' });
    expect(result.flags).not.toContain('PHOTO_MISSING');
  });

  it('requires a photo under RISK_BASED only when something else looks wrong', () => {
    const clean = evaluate({ hasPhoto: false }, { photoRequired: 'RISK_BASED' });
    expect(clean.flags).not.toContain('PHOTO_MISSING');

    const risky = evaluate(
      { hasPhoto: false, location: { latitude: 13.7563, longitude: 100.5018, accuracyM: 10 } },
      { photoRequired: 'RISK_BASED' },
    );
    expect(risky.flags).toContain('PHOTO_MISSING');
  });

  it('rejects a gallery photo under strict capture policy', () => {
    // spec §6.3: ห้ามใช้รูปจาก gallery ใน strict mode
    const result = evaluate({ liveCapture: false }, { riskAction: 'REJECT' });
    expect(result.flags).toContain('PHOTO_NOT_LIVE_CAPTURE');
    expect(result.decision).toBe('REJECTED_POLICY');
  });

  it('flags a photo that was submitted before', () => {
    const result = evaluate({ duplicatePhoto: true });
    expect(result.flags).toContain('PHOTO_DUPLICATE');
    expect(result.score).toBeGreaterThanOrEqual(55);
  });
});

describe('evaluateCheckin — device and timing risk', () => {
  it('flags an unenrolled device', () => {
    expect(evaluate({ deviceEnrolled: false }).flags).toContain('DEVICE_NOT_ENROLLED');
  });

  it('flags failed attestation but tolerates unavailable', () => {
    expect(evaluate({ attestationStatus: 'FAILED' }).flags).toContain('DEVICE_ATTESTATION_FAILED');
    // PWA ตรวจ attestation ไม่ได้ — UNAVAILABLE ต้องไม่ถือเป็นความเสี่ยง (spec §6.4)
    expect(evaluate({ attestationStatus: 'UNAVAILABLE' }).flags).toEqual([]);
  });

  it('flags a commit that came long after the capture', () => {
    const result = evaluate({ committedAt: new Date(capturedAt.getTime() + 120_000) });
    expect(result.flags).toContain('CAPTURE_DEADLINE_EXCEEDED');
  });

  it('allows a late commit when offline capture is permitted', () => {
    const result = evaluate(
      { committedAt: new Date(capturedAt.getTime() + 30 * 60_000) },
      { allowOfflineCapture: true, offlineMaxAgeMinutes: 120 },
    );
    expect(result.flags).not.toContain('CAPTURE_DEADLINE_EXCEEDED');
    expect(result.flags).not.toContain('OFFLINE_TOO_OLD');
  });

  it('flags an offline capture that is older than the policy allows', () => {
    const result = evaluate(
      { committedAt: new Date(capturedAt.getTime() + 5 * 3600_000) },
      { allowOfflineCapture: true, offlineMaxAgeMinutes: 120 },
    );
    expect(result.flags).toContain('OFFLINE_TOO_OLD');
  });

  it('flags a capture timestamp in the future', () => {
    const result = evaluate({ committedAt: new Date(capturedAt.getTime() - 60_000) });
    expect(result.flags).toContain('CLOCK_SKEW');
  });
});

describe('evaluateCheckin — movement risk', () => {
  it('flags impossible travel between consecutive check-ins', () => {
    const result = evaluate({
      previousCheckin: {
        at: new Date(capturedAt.getTime() - 5 * 60_000),
        latitude: 18.7883,
        longitude: 98.9853,
      },
    });
    expect(result.flags).toContain('IMPOSSIBLE_TRAVEL');
  });

  it('flags a repeat check-in within a minute', () => {
    const result = evaluate({
      previousCheckin: {
        at: new Date(capturedAt.getTime() - 20_000),
        latitude: 12.9231,
        longitude: 100.8826,
      },
    });
    expect(result.flags).toContain('RAPID_REPEAT_CHECKIN');
  });

  it('accepts a normal commute between shifts', () => {
    const result = evaluate({
      previousCheckin: {
        at: new Date(capturedAt.getTime() - 8 * 3600_000),
        latitude: 13.7563,
        longitude: 100.5018,
      },
    });
    expect(result.flags).toEqual([]);
  });
});

describe('evaluateCheckin — decision mapping', () => {
  it('warns instead of blocking when the policy says warn', () => {
    const result = evaluate({ deviceEnrolled: false }, { riskAction: 'WARN' });
    expect(result.decision).toBe('ACCEPTED_WITH_WARNING');
    expect(createsTimeEvent(result.decision)).toBe(true);
  });

  it('sends soft risks to review even when the policy says reject', () => {
    // spec §6.4: ห้ามปฏิเสธแบบมืดมน — GPS แกว่งต้องไม่ทำให้ลงเวลาไม่ได้
    const result = evaluate(
      { location: { latitude: 12.9231, longitude: 100.8826, accuracyM: 500 } },
      { riskAction: 'REJECT' },
    );
    expect(result.flags).toEqual(['LOCATION_ACCURACY_POOR']);
    expect(result.decision).toBe('PENDING_REVIEW');
    expect(createsTimeEvent(result.decision)).toBe(true);
  });

  it('caps the risk score at 100', () => {
    const result = evaluate({
      hasPhoto: true,
      liveCapture: false,
      duplicatePhoto: true,
      deviceEnrolled: false,
      attestationStatus: 'FAILED',
      mockLocationSuspected: true,
      location: { latitude: 13.7563, longitude: 100.5018, accuracyM: 900 },
    });
    expect(result.score).toBe(100);
  });
});
