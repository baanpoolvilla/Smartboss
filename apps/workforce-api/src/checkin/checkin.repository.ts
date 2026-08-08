import { Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { and, desc, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';

@Injectable()
export class CheckinRepository {
  // --- policy groups ---

  async insertPolicyGroup(
    tx: Tx,
    values: typeof schema.attendancePolicyGroups.$inferInsert,
  ): Promise<typeof schema.attendancePolicyGroups.$inferSelect> {
    const rows = await tx.insert(schema.attendancePolicyGroups).values(values).returning();
    return rows[0] as typeof schema.attendancePolicyGroups.$inferSelect;
  }

  async findPolicyGroupById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.attendancePolicyGroups.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.attendancePolicyGroups)
      .where(eq(schema.attendancePolicyGroups.id, id))
      .limit(1);
    return rows[0];
  }

  /**
   * นโยบายที่มีผลกับพนักงานคนนี้ ณ วันที่ระบุ
   * resolve แบบ point-in-time เสมอ ไม่ใช่ "แถวล่าสุด" (ADR-0012)
   */
  async resolvePolicyForEmployment(
    tx: Tx,
    employmentId: string,
    asOf: string,
  ): Promise<typeof schema.attendancePolicyGroups.$inferSelect | undefined> {
    const rows = await tx
      .select({ group: schema.attendancePolicyGroups })
      .from(schema.attendancePolicyGroupMembers)
      .innerJoin(
        schema.attendancePolicyGroups,
        eq(schema.attendancePolicyGroups.id, schema.attendancePolicyGroupMembers.policyGroupId),
      )
      .where(
        and(
          eq(schema.attendancePolicyGroupMembers.employmentId, employmentId),
          sql`${schema.attendancePolicyGroupMembers.effectiveFrom} <= ${asOf}`,
          or(
            isNull(schema.attendancePolicyGroupMembers.effectiveTo),
            sql`${schema.attendancePolicyGroupMembers.effectiveTo} >= ${asOf}`,
          ),
          sql`${schema.attendancePolicyGroups.effectiveFrom} <= ${asOf}`,
          or(
            isNull(schema.attendancePolicyGroups.effectiveTo),
            sql`${schema.attendancePolicyGroups.effectiveTo} >= ${asOf}`,
          ),
        ),
      )
      .limit(1);
    return rows[0]?.group;
  }

  async insertPolicyMember(
    tx: Tx,
    values: typeof schema.attendancePolicyGroupMembers.$inferInsert,
  ): Promise<void> {
    await tx.insert(schema.attendancePolicyGroupMembers).values(values);
  }

  async findOpenPolicyMember(
    tx: Tx,
    employmentId: string,
  ): Promise<typeof schema.attendancePolicyGroupMembers.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.attendancePolicyGroupMembers)
      .where(
        and(
          eq(schema.attendancePolicyGroupMembers.employmentId, employmentId),
          isNull(schema.attendancePolicyGroupMembers.effectiveTo),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async closePolicyMember(tx: Tx, id: string, effectiveTo: string): Promise<void> {
    await tx
      .update(schema.attendancePolicyGroupMembers)
      .set({ effectiveTo })
      .where(eq(schema.attendancePolicyGroupMembers.id, id));
  }

  // --- mobile devices ---

  async insertMobileDevice(
    tx: Tx,
    values: typeof schema.mobileDeviceRegistrations.$inferInsert,
  ): Promise<typeof schema.mobileDeviceRegistrations.$inferSelect> {
    const rows = await tx.insert(schema.mobileDeviceRegistrations).values(values).returning();
    return rows[0] as typeof schema.mobileDeviceRegistrations.$inferSelect;
  }

  async findMobileDeviceById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.mobileDeviceRegistrations.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.mobileDeviceRegistrations)
      .where(eq(schema.mobileDeviceRegistrations.id, id))
      .limit(1);
    return rows[0];
  }

  async findActiveMobileDevice(
    tx: Tx,
    employmentId: string,
  ): Promise<typeof schema.mobileDeviceRegistrations.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.mobileDeviceRegistrations)
      .where(
        and(
          eq(schema.mobileDeviceRegistrations.employmentId, employmentId),
          eq(schema.mobileDeviceRegistrations.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async findMobileDeviceByFingerprint(
    tx: Tx,
    employmentId: string,
    fingerprint: string,
  ): Promise<typeof schema.mobileDeviceRegistrations.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.mobileDeviceRegistrations)
      .where(
        and(
          eq(schema.mobileDeviceRegistrations.employmentId, employmentId),
          eq(schema.mobileDeviceRegistrations.deviceFingerprint, fingerprint),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listMobileDevices(
    tx: Tx,
    employmentId: string,
  ): Promise<(typeof schema.mobileDeviceRegistrations.$inferSelect)[]> {
    return tx
      .select()
      .from(schema.mobileDeviceRegistrations)
      .where(eq(schema.mobileDeviceRegistrations.employmentId, employmentId))
      .orderBy(desc(schema.mobileDeviceRegistrations.createdAt));
  }

  async updateMobileDevice(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.mobileDeviceRegistrations.$inferInsert>,
  ): Promise<typeof schema.mobileDeviceRegistrations.$inferSelect | undefined> {
    const rows = await tx
      .update(schema.mobileDeviceRegistrations)
      .set(values)
      .where(eq(schema.mobileDeviceRegistrations.id, id))
      .returning();
    return rows[0];
  }

  // --- sessions ---

  async insertSession(
    tx: Tx,
    values: typeof schema.photoCheckinSessions.$inferInsert,
  ): Promise<typeof schema.photoCheckinSessions.$inferSelect> {
    const rows = await tx.insert(schema.photoCheckinSessions).values(values).returning();
    return rows[0] as typeof schema.photoCheckinSessions.$inferSelect;
  }

  async findSessionById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.photoCheckinSessions.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.photoCheckinSessions)
      .where(eq(schema.photoCheckinSessions.id, id))
      .limit(1)
      .for('update');
    return rows[0];
  }

  async updateSession(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.photoCheckinSessions.$inferInsert>,
  ): Promise<void> {
    await tx.update(schema.photoCheckinSessions).set(values).where(eq(schema.photoCheckinSessions.id, id));
  }

  // --- evidence ---

  async insertStorageObject(
    tx: Tx,
    values: typeof schema.storageObjects.$inferInsert,
  ): Promise<void> {
    await tx.insert(schema.storageObjects).values(values);
  }

  async insertPhotoEvidence(
    tx: Tx,
    values: typeof schema.photoEvidenceObjects.$inferInsert,
  ): Promise<typeof schema.photoEvidenceObjects.$inferSelect> {
    const rows = await tx.insert(schema.photoEvidenceObjects).values(values).returning();
    return rows[0] as typeof schema.photoEvidenceObjects.$inferSelect;
  }

  async findPhotoEvidenceById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.photoEvidenceObjects.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.photoEvidenceObjects)
      .where(eq(schema.photoEvidenceObjects.id, id))
      .limit(1);
    return rows[0];
  }

  async findEvidenceForSession(
    tx: Tx,
    sessionId: string,
  ): Promise<typeof schema.photoEvidenceObjects.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.photoEvidenceObjects)
      .where(eq(schema.photoEvidenceObjects.sessionId, sessionId))
      .orderBy(desc(schema.photoEvidenceObjects.createdAt))
      .limit(1);
    return rows[0];
  }

  /** ตรวจรูปซ้ำจาก checksum โดยไม่ต้องดาวน์โหลดไฟล์ (spec §6.4) */
  async photoChecksumSeen(tx: Tx, sha256: Buffer, excludeSessionId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: schema.photoEvidenceObjects.id })
      .from(schema.photoEvidenceObjects)
      .where(
        and(
          eq(schema.photoEvidenceObjects.sha256, sha256),
          sql`${schema.photoEvidenceObjects.sessionId} <> ${excludeSessionId}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async insertTimeEventEvidence(
    tx: Tx,
    values: typeof schema.timeEventEvidence.$inferInsert,
  ): Promise<void> {
    await tx.insert(schema.timeEventEvidence).values(values);
  }

  async insertRiskAssessment(
    tx: Tx,
    values: typeof schema.mobileRiskAssessments.$inferInsert,
  ): Promise<typeof schema.mobileRiskAssessments.$inferSelect> {
    const rows = await tx.insert(schema.mobileRiskAssessments).values(values).returning();
    return rows[0] as typeof schema.mobileRiskAssessments.$inferSelect;
  }

  async findRiskAssessmentById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.mobileRiskAssessments.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.mobileRiskAssessments)
      .where(eq(schema.mobileRiskAssessments.id, id))
      .limit(1);
    return rows[0];
  }

  async listRiskAssessments(
    tx: Tx,
    options: {
      cursor: string | null;
      limit: number;
      decision?: string;
      employmentId?: string;
      unreviewedOnly: boolean;
    },
  ): Promise<(typeof schema.mobileRiskAssessments.$inferSelect)[]> {
    const conditions: SQL[] = [];
    if (options.cursor !== null) conditions.push(gt(schema.mobileRiskAssessments.id, options.cursor));
    if (options.decision !== undefined)
      conditions.push(eq(schema.mobileRiskAssessments.decision, options.decision));
    if (options.employmentId !== undefined)
      conditions.push(eq(schema.mobileRiskAssessments.employmentId, options.employmentId));
    if (options.unreviewedOnly) conditions.push(isNull(schema.mobileRiskAssessments.reviewedAt));

    return tx
      .select()
      .from(schema.mobileRiskAssessments)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.mobileRiskAssessments.createdAt))
      .limit(options.limit);
  }

  async updateRiskAssessment(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.mobileRiskAssessments.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(schema.mobileRiskAssessments)
      .set(values)
      .where(eq(schema.mobileRiskAssessments.id, id));
  }

  /** ลงเวลาครั้งก่อนของพนักงาน — ใช้ตรวจ impossible travel */
  async findPreviousCheckin(
    tx: Tx,
    employmentId: string,
    before: Date,
  ): Promise<{ at: Date; latitude: number; longitude: number } | undefined> {
    const rows = await tx
      .select({
        capturedAt: schema.rawTimeEvents.capturedAt,
        latitude: schema.timeEventEvidence.latitude,
        longitude: schema.timeEventEvidence.longitude,
      })
      .from(schema.rawTimeEvents)
      .innerJoin(
        schema.timeEventEvidence,
        eq(schema.timeEventEvidence.rawTimeEventId, schema.rawTimeEvents.id),
      )
      .where(
        and(
          eq(schema.rawTimeEvents.employmentId, employmentId),
          sql`${schema.rawTimeEvents.capturedAt} < ${before}`,
          sql`${schema.timeEventEvidence.latitude} IS NOT NULL`,
        ),
      )
      .orderBy(desc(schema.rawTimeEvents.capturedAt))
      .limit(1);

    const row = rows[0];
    if (row === undefined || row.latitude === null || row.longitude === null) return undefined;
    return {
      at: row.capturedAt,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
    };
  }

  async listSitesForCompany(
    tx: Tx,
    companyId: string,
  ): Promise<(typeof schema.sites.$inferSelect)[]> {
    return tx.select().from(schema.sites).where(eq(schema.sites.companyId, companyId));
  }
}
