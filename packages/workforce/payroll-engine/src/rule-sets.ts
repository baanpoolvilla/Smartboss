import { EffectivePeriod, LocalDate } from '@workforce/domain';
import type { FormulaNode } from './formula';

/**
 * ชุดกฎตามกฎหมาย (spec §9.5)
 *
 * ค่าตามกฎหมายทุกตัวต้องอยู่ในนี้ ไม่ใช่ใน code — และ **publish ไม่ได้จนกว่าจะมี
 * ผู้รับรอง** เพราะ spec §9.5 ห้ามถือว่าค่าจากระบบเดิมถูกต้องตลอดเวลา
 */

export type RuleType =
  | 'TH_PIT_WITHHOLDING'
  | 'TH_SOCIAL_SECURITY'
  | 'PROVIDENT_FUND'
  | 'OT_MULTIPLIER'
  | 'SEVERANCE'
  | 'MINIMUM_WAGE';

export type RuleSetStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

export interface StatutoryRuleSet {
  id: string;
  jurisdiction: string;
  ruleType: RuleType;
  version: string;
  status: RuleSetStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  /** พารามิเตอร์ที่สูตรอ้างถึงผ่าน `var` เช่น sso_rate, sso_ceiling */
  parameters: Readonly<Record<string, string>>;
  formulas: Readonly<Record<string, FormulaNode>>;
  sourceReference: string;
  approvedBy: string | null;
  approvedAt: string | null;
  goldenTestsPassed: boolean;
}

export class RuleSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleSetError';
  }
}

/**
 * เงื่อนไขการ publish ชุดกฎ
 *
 * ทั้งสี่ข้อมาจาก spec §9.5 โดยตรง — ขาดข้อใดข้อหนึ่งแปลว่ายังไม่มีใคร
 * รับผิดชอบความถูกต้องของตัวเลขที่จะเอาไปคำนวณเงินจริง
 */
export function assertPublishable(ruleSet: StatutoryRuleSet): void {
  const problems: string[] = [];

  if (ruleSet.sourceReference.trim() === '') {
    problems.push('sourceReference is required (link to the law, notice or circular)');
  }
  if (ruleSet.approvedBy === null || ruleSet.approvedBy.trim() === '') {
    problems.push('approvedBy is required (Payroll SME, accounting or legal)');
  }
  if (ruleSet.approvedAt === null) {
    problems.push('approvedAt is required');
  }
  if (!ruleSet.goldenTestsPassed) {
    problems.push('the golden test pack for this rule type must pass first');
  }

  if (problems.length > 0) {
    throw new RuleSetError(
      `rule set ${ruleSet.ruleType} ${ruleSet.version} cannot be published:\n  - ${problems.join('\n  - ')}`,
    );
  }
}

/**
 * เลือกชุดกฎที่มีผล ณ วันที่ระบุ
 *
 * เฉพาะ PUBLISHED เท่านั้น — DRAFT ใช้ทดลองคำนวณได้ แต่ต้องไม่หลุดเข้า payroll จริง
 */
export function resolveRuleSet(
  ruleSets: readonly StatutoryRuleSet[],
  ruleType: RuleType,
  asOf: string,
): StatutoryRuleSet | undefined {
  const date = LocalDate.parse(asOf);

  const candidates = ruleSets.filter((ruleSet) => {
    if (ruleSet.ruleType !== ruleType) return false;
    if (ruleSet.status !== 'PUBLISHED') return false;
    return EffectivePeriod.parse(ruleSet.effectiveFrom, ruleSet.effectiveTo).contains(date);
  });

  if (candidates.length === 0) return undefined;

  // ถ้ามีหลายชุดที่ครอบวันเดียวกัน ให้ใช้ชุดที่เริ่มมีผลล่าสุด
  return candidates.reduce((latest, candidate) =>
    LocalDate.parse(candidate.effectiveFrom).isAfter(LocalDate.parse(latest.effectiveFrom))
      ? candidate
      : latest,
  );
}

/** รวมพารามิเตอร์ของชุดกฎที่มีผลทั้งหมดเป็นตัวแปรของสูตร */
export function ruleParameters(
  ruleSets: readonly StatutoryRuleSet[],
  asOf: string,
  required: readonly RuleType[],
): { parameters: Record<string, string>; missing: RuleType[] } {
  const parameters: Record<string, string> = {};
  const missing: RuleType[] = [];

  for (const ruleType of required) {
    const resolved = resolveRuleSet(ruleSets, ruleType, asOf);
    if (resolved === undefined) {
      missing.push(ruleType);
      continue;
    }
    for (const [key, value] of Object.entries(resolved.parameters)) {
      parameters[key] = value;
    }
  }

  return { parameters, missing };
}
