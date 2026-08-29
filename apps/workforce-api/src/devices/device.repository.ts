import { Injectable } from '@nestjs/common';
import { schema, type Tx } from '@workforce/db';
import { and, asc, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';

export interface DeviceAuthLookup {
  tenantId: string;
  companyId: string;
  deviceStatus: string;
  publicKey: Buffer;
  algorithm: string;
}

export interface ActivationTokenLookup {
  tokenId: string;
  tenantId: string;
  deviceId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

@Injectable()
export class DeviceRepository {
  // --- devices ---

  /**
   * รายการสแกนดิบพร้อมชื่อคนและรหัสเครื่อง
   *
   * left join กับ employments/people เพราะ employment_id เป็น null ได้ —
   * slot ที่ยังไม่ผูกกับใครก็ยังถูกบันทึกเป็นหลักฐาน (spec §3.3 C9) และนั่นคือ
   * แถวที่ต้องมองเห็นที่สุด ถ้า inner join จะหายไปพอดีกับกรณีที่ต้องแก้
   */
  async listRawTimeEvents(
    tx: Tx,
    query: { from: string; to: string; employmentId?: string; limit: number },
  ): Promise<Record<string, unknown>[]> {
    const filters: SQL[] = [
      sql`${schema.rawTimeEvents.capturedAt} >= ${`${query.from}T00:00:00Z`}`,
      sql`${schema.rawTimeEvents.capturedAt} <= ${`${query.to}T23:59:59Z`}`,
    ];
    if (query.employmentId !== undefined) {
      filters.push(eq(schema.rawTimeEvents.employmentId, query.employmentId));
    }

    const rows = await tx
      .select({
        id: schema.rawTimeEvents.id,
        employmentId: schema.rawTimeEvents.employmentId,
        capturedAt: schema.rawTimeEvents.capturedAt,
        receivedAt: schema.rawTimeEvents.receivedAt,
        sourceType: schema.rawTimeEvents.sourceType,
        eventIntent: schema.rawTimeEvents.eventIntent,
        status: schema.rawTimeEvents.status,
        evidence: schema.rawTimeEvents.evidence,
        deviceCode: schema.devices.deviceCode,
        deviceName: schema.devices.name,
        employeeCode: schema.employments.employeeCode,
        firstName: schema.people.firstName,
        lastName: schema.people.lastName,
        preferredName: schema.people.preferredName,
      })
      .from(schema.rawTimeEvents)
      .leftJoin(schema.devices, eq(schema.devices.id, schema.rawTimeEvents.sourceId))
      .leftJoin(
        schema.employments,
        eq(schema.employments.id, schema.rawTimeEvents.employmentId),
      )
      .leftJoin(schema.people, eq(schema.people.id, schema.employments.personId))
      .where(and(...filters))
      .orderBy(desc(schema.rawTimeEvents.capturedAt))
      .limit(query.limit);

    return rows.map((row) => {
      const evidence = (row.evidence ?? {}) as Record<string, unknown>;
      const preferred = (row.preferredName ?? '').trim();
      return {
        id: row.id,
        employment_id: row.employmentId,
        display_name:
          row.firstName === null
            ? null
            : preferred === ''
              ? `${row.firstName} ${row.lastName ?? ''}`.trim()
              : preferred,
        employee_code: row.employeeCode,
        captured_at: row.capturedAt.toISOString(),
        received_at: row.receivedAt.toISOString(),
        source_type: row.sourceType,
        device_code: row.deviceCode,
        device_name: row.deviceName,
        event_intent: row.eventIntent,
        status: row.status,
        template_slot: evidence['template_slot'] ?? null,
        // false = สแกนติดแต่ไม่รู้ว่าใคร → ไม่กลายเป็นเวลาทำงานของใครเลย
        slot_resolved: evidence['slot_resolved'] === true,
        match_score: evidence['match_score'] ?? null,
      };
    });
  }

  async insertDevice(
    tx: Tx,
    values: typeof schema.devices.$inferInsert,
  ): Promise<typeof schema.devices.$inferSelect> {
    const rows = await tx.insert(schema.devices).values(values).returning();
    return rows[0] as typeof schema.devices.$inferSelect;
  }

  async findDeviceById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.devices.$inferSelect | undefined> {
    const rows = await tx.select().from(schema.devices).where(eq(schema.devices.id, id)).limit(1);
    return rows[0];
  }

  async lockDevice(tx: Tx, id: string): Promise<typeof schema.devices.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.id, id))
      .limit(1)
      .for('update');
    return rows[0];
  }

  async listDevices(
    tx: Tx,
    options: { cursor: string | null; limit: number; companyId?: string; status?: string },
  ): Promise<(typeof schema.devices.$inferSelect)[]> {
    const conditions: SQL[] = [];
    if (options.cursor !== null) conditions.push(gt(schema.devices.id, options.cursor));
    if (options.companyId !== undefined)
      conditions.push(eq(schema.devices.companyId, options.companyId));
    if (options.status !== undefined) conditions.push(eq(schema.devices.status, options.status));

    return tx
      .select()
      .from(schema.devices)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(schema.devices.id))
      .limit(options.limit);
  }

  async updateDevice(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.devices.$inferInsert>,
  ): Promise<typeof schema.devices.$inferSelect | undefined> {
    const rows = await tx
      .update(schema.devices)
      .set(values)
      .where(eq(schema.devices.id, id))
      .returning();
    return rows[0];
  }

  // --- credentials ---

  async findActiveCredential(
    tx: Tx,
    deviceId: string,
  ): Promise<typeof schema.deviceCredentials.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.deviceCredentials)
      .where(
        and(
          eq(schema.deviceCredentials.deviceId, deviceId),
          eq(schema.deviceCredentials.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async insertCredential(
    tx: Tx,
    values: typeof schema.deviceCredentials.$inferInsert,
  ): Promise<void> {
    await tx.insert(schema.deviceCredentials).values(values);
  }

  async revokeCredentials(
    tx: Tx,
    deviceId: string,
    revokedAt: Date,
    reason: string,
  ): Promise<number> {
    const rows = await tx
      .update(schema.deviceCredentials)
      .set({ status: 'REVOKED', revokedAt, revokedReason: reason })
      .where(
        and(
          eq(schema.deviceCredentials.deviceId, deviceId),
          eq(schema.deviceCredentials.status, 'ACTIVE'),
        ),
      )
      .returning({ id: schema.deviceCredentials.id });
    return rows.length;
  }

  // --- activation tokens ---

  async insertActivationToken(
    tx: Tx,
    values: typeof schema.deviceActivationTokens.$inferInsert,
  ): Promise<void> {
    await tx.insert(schema.deviceActivationTokens).values(values);
  }

  async markActivationTokenUsed(tx: Tx, tokenId: string, usedAt: Date): Promise<number> {
    // เงื่อนไข used_at IS NULL ทำให้ token ใช้ได้ครั้งเดียวจริง แม้มีสองคำขอเข้ามาพร้อมกัน
    const rows = await tx
      .update(schema.deviceActivationTokens)
      .set({ usedAt })
      .where(
        and(
          eq(schema.deviceActivationTokens.id, tokenId),
          sql`${schema.deviceActivationTokens.usedAt} IS NULL`,
        ),
      )
      .returning({ id: schema.deviceActivationTokens.id });
    return rows.length;
  }

  /**
   * ค้นหา credential ข้าม tenant ผ่าน SECURITY DEFINER function
   *
   * ใช้เฉพาะตอน authenticate เครื่อง ซึ่งยังไม่รู้ว่าอยู่ tenant ไหน — เป็นช่อง
   * แคบ ๆ ที่เปิดไว้อย่างตั้งใจ ไม่ใช่การปิด RLS ทั้ง connection (ดู migration 0002)
   */
  async lookupDeviceAuth(tx: Tx, deviceId: string): Promise<DeviceAuthLookup | undefined> {
    const result = await tx.execute(
      sql`SELECT * FROM workforce.lookup_device_credential(${deviceId}::uuid)`,
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;

    return {
      tenantId: String(row['tenant_id']),
      companyId: String(row['company_id']),
      deviceStatus: String(row['device_status']),
      publicKey: toBuffer(row['public_key']),
      algorithm: String(row['algorithm']),
    };
  }

  async lookupActivationToken(
    tx: Tx,
    tokenHash: Buffer,
  ): Promise<ActivationTokenLookup | undefined> {
    const result = await tx.execute(
      sql`SELECT * FROM workforce.lookup_activation_token(${tokenHash})`,
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) return undefined;

    return {
      tokenId: String(row['token_id']),
      tenantId: String(row['tenant_id']),
      deviceId: String(row['device_id']),
      expiresAt: new Date(String(row['expires_at'])),
      usedAt: row['used_at'] === null ? null : new Date(String(row['used_at'])),
    };
  }

  // --- commands ---

  async insertCommand(
    tx: Tx,
    values: typeof schema.deviceCommands.$inferInsert,
  ): Promise<typeof schema.deviceCommands.$inferSelect> {
    const rows = await tx.insert(schema.deviceCommands).values(values).returning();
    return rows[0] as typeof schema.deviceCommands.$inferSelect;
  }

  async listPendingCommands(
    tx: Tx,
    deviceId: string,
    now: Date,
  ): Promise<(typeof schema.deviceCommands.$inferSelect)[]> {
    return tx
      .select()
      .from(schema.deviceCommands)
      .where(
        and(
          eq(schema.deviceCommands.deviceId, deviceId),
          sql`${schema.deviceCommands.status} IN ('PENDING', 'DELIVERED')`,
          sql`${schema.deviceCommands.expiresAt} > ${now}`,
        ),
      )
      .orderBy(asc(schema.deviceCommands.createdAt))
      .limit(20);
  }

  async findCommandByNonce(
    tx: Tx,
    deviceId: string,
    nonce: Buffer,
  ): Promise<typeof schema.deviceCommands.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.deviceCommands)
      .where(
        and(eq(schema.deviceCommands.deviceId, deviceId), eq(schema.deviceCommands.nonce, nonce)),
      )
      .limit(1);
    return rows[0];
  }

  async updateCommand(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.deviceCommands.$inferInsert>,
  ): Promise<void> {
    await tx.update(schema.deviceCommands).set(values).where(eq(schema.deviceCommands.id, id));
  }

  async markCommandsDelivered(tx: Tx, ids: string[], deliveredAt: Date): Promise<void> {
    if (ids.length === 0) return;
    // ใช้ inArray ไม่ใช่ `= ANY($1)`: การผูก JS array เป็นพารามิเตอร์เดียวทำให้
    // driver ต้องเดา element type ของ array เอง ซึ่งล้มเหลวกับคอลัมน์ uuid
    await tx
      .update(schema.deviceCommands)
      .set({ status: 'DELIVERED', deliveredAt })
      .where(inArray(schema.deviceCommands.id, ids));
  }

  // --- biometric enrolments ---

  async insertEnrollment(
    tx: Tx,
    values: typeof schema.biometricEnrollments.$inferInsert,
  ): Promise<typeof schema.biometricEnrollments.$inferSelect> {
    const rows = await tx.insert(schema.biometricEnrollments).values(values).returning();
    return rows[0] as typeof schema.biometricEnrollments.$inferSelect;
  }

  async findEnrollmentById(
    tx: Tx,
    id: string,
  ): Promise<typeof schema.biometricEnrollments.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.biometricEnrollments)
      .where(eq(schema.biometricEnrollments.id, id))
      .limit(1);
    return rows[0];
  }

  /** map slot ของเครื่อง → employment; หัวใจของการแปลง scan เป็นเวลาทำงาน */
  async findEnrollmentBySlot(
    tx: Tx,
    deviceId: string,
    slot: number,
  ): Promise<typeof schema.biometricEnrollments.$inferSelect | undefined> {
    const rows = await tx
      .select()
      .from(schema.biometricEnrollments)
      .where(
        and(
          eq(schema.biometricEnrollments.deviceId, deviceId),
          eq(schema.biometricEnrollments.templateSlot, slot),
          eq(schema.biometricEnrollments.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async listEnrollments(
    tx: Tx,
    filters: { employmentId?: string; deviceId?: string },
  ): Promise<(typeof schema.biometricEnrollments.$inferSelect)[]> {
    const conditions: SQL[] = [];
    if (filters.employmentId !== undefined)
      conditions.push(eq(schema.biometricEnrollments.employmentId, filters.employmentId));
    if (filters.deviceId !== undefined)
      conditions.push(eq(schema.biometricEnrollments.deviceId, filters.deviceId));

    return tx
      .select()
      .from(schema.biometricEnrollments)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.biometricEnrollments.createdAt));
  }

  async updateEnrollment(
    tx: Tx,
    id: string,
    values: Partial<typeof schema.biometricEnrollments.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(schema.biometricEnrollments)
      .set(values)
      .where(eq(schema.biometricEnrollments.id, id));
  }

  async insertDeletionJob(
    tx: Tx,
    values: typeof schema.biometricDeletionJobs.$inferInsert,
  ): Promise<void> {
    await tx.insert(schema.biometricDeletionJobs).values(values);
  }

  async updateDeletionJobsByCommand(
    tx: Tx,
    commandId: string,
    values: Partial<typeof schema.biometricDeletionJobs.$inferInsert>,
  ): Promise<void> {
    await tx
      .update(schema.biometricDeletionJobs)
      .set(values)
      .where(eq(schema.biometricDeletionJobs.commandId, commandId));
  }

  async insertHeartbeat(
    tx: Tx,
    values: typeof schema.deviceHeartbeats.$inferInsert,
  ): Promise<void> {
    await tx.insert(schema.deviceHeartbeats).values(values);
  }
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') {
    // PostgreSQL hex format ของ bytea เมื่อ driver ไม่ได้ decode ให้
    return value.startsWith('\\x') ? Buffer.from(value.slice(2), 'hex') : Buffer.from(value, 'utf8');
  }
  throw new TypeError('expected bytea value');

}
