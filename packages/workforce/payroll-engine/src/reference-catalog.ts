import type { PayItemDefinition } from './calculate';
import type { StatutoryRuleSet } from './rule-sets';

/**
 * แคตตาล็อกอ้างอิงสำหรับ dev/demo — **ไม่ใช่ค่าที่ผ่านการรับรอง**
 *
 * spec §9.5 ห้ามถือว่าค่าจากระบบเดิม (5%, เพดาน 750, หาร 30/8, อัตราภาษีชุดเดิม)
 * ถูกต้องตลอดเวลา ชุดกฎด้านล่างจึงมีสถานะ `DRAFT` และ `approvedBy: null`
 * ซึ่ง `assertPublishable()` จะปฏิเสธ — ต้องให้ Payroll SME กรอกและเซ็นใน
 * docs/phase0/rule-matrix.md ก่อนจึงจะ publish ได้
 */

const HALF_UP_2 = { roundingDecimals: 2, roundingMode: 'HALF_UP' as const };

export const REFERENCE_PAY_ITEMS: readonly PayItemDefinition[] = [
  {
    code: 'SALARY',
    name: 'เงินเดือน',
    category: 'EARNING',
    calculationType: 'FORMULA',
    // เงินเดือนตามสัญญา ปรับตามสัดส่วนวันที่ทำงานจริงในงวด
    formula: {
      kind: 'multiply',
      money: { kind: 'var', name: 'monthly_salary' },
      rate: { kind: 'var', name: 'period_proration' },
    },
    affectsNetPay: true,
    taxable: true,
    socialSecurityBase: true,
    providentFundBase: true,
    employerOnly: false,
    displayOrder: 10,
    ...HALF_UP_2,
  },
  {
    code: 'OVERTIME_WORKDAY',
    name: 'ค่าล่วงเวลาวันทำงาน',
    category: 'EARNING',
    calculationType: 'ATTENDANCE',
    formula: {
      kind: 'multiply',
      money: {
        kind: 'multiply',
        money: { kind: 'var', name: 'hourly_rate' },
        rate: { kind: 'minutes_to_hours', minutes: { kind: 'var', name: 'ot_workday_minutes' } },
      },
      // ตัวคูณมาจาก rule set ไม่ได้ฝัง 1.5 ไว้ในโค้ด (spec §8.3)
      rate: { kind: 'var', name: 'ot_workday_multiplier' },
    },
    affectsNetPay: true,
    taxable: true,
    socialSecurityBase: true,
    providentFundBase: false,
    employerOnly: false,
    displayOrder: 20,
    ...HALF_UP_2,
  },
  {
    code: 'OVERTIME_HOLIDAY',
    name: 'ค่าล่วงเวลาวันหยุด',
    category: 'EARNING',
    calculationType: 'ATTENDANCE',
    formula: {
      kind: 'multiply',
      money: {
        kind: 'multiply',
        money: { kind: 'var', name: 'hourly_rate' },
        rate: { kind: 'minutes_to_hours', minutes: { kind: 'var', name: 'ot_holiday_minutes' } },
      },
      rate: { kind: 'var', name: 'ot_holiday_multiplier' },
    },
    affectsNetPay: true,
    taxable: true,
    socialSecurityBase: true,
    providentFundBase: false,
    employerOnly: false,
    displayOrder: 21,
    ...HALF_UP_2,
  },
  {
    code: 'COMMISSION',
    name: 'ค่าคอมมิชชั่น',
    category: 'EARNING',
    calculationType: 'IMPORT',
    formula: null,
    affectsNetPay: true,
    taxable: true,
    socialSecurityBase: true,
    providentFundBase: false,
    employerOnly: false,
    displayOrder: 30,
    ...HALF_UP_2,
  },
  {
    code: 'UNPAID_LEAVE_DEDUCTION',
    name: 'หักลาไม่รับค่าจ้าง',
    category: 'DEDUCTION',
    calculationType: 'ATTENDANCE',
    formula: {
      kind: 'multiply',
      money: { kind: 'var', name: 'daily_rate' },
      rate: { kind: 'var', name: 'unpaid_leave_days' },
    },
    affectsNetPay: true,
    taxable: false,
    socialSecurityBase: false,
    providentFundBase: false,
    employerOnly: false,
    displayOrder: 40,
    ...HALF_UP_2,
  },
  {
    code: 'ABSENCE_DEDUCTION',
    name: 'หักขาดงาน',
    category: 'DEDUCTION',
    calculationType: 'ATTENDANCE',
    formula: {
      kind: 'multiply',
      money: { kind: 'var', name: 'hourly_rate' },
      rate: { kind: 'minutes_to_hours', minutes: { kind: 'var', name: 'absence_minutes' } },
    },
    affectsNetPay: true,
    taxable: false,
    socialSecurityBase: false,
    providentFundBase: false,
    employerOnly: false,
    displayOrder: 41,
    ...HALF_UP_2,
  },
  {
    code: 'SOCIAL_SECURITY_EMPLOYEE',
    name: 'ประกันสังคม (ลูกจ้าง)',
    category: 'DEDUCTION',
    calculationType: 'PERCENTAGE',
    // เพดานมาจาก rule set — ระบบเดิมฝัง Math.min(base*0.05, 750) ไว้ในโค้ด (spec §3.3 P6)
    formula: {
      kind: 'cap',
      value: {
        kind: 'multiply',
        money: {
          kind: 'cap',
          value: { kind: 'item', code: 'SALARY' },
          ceiling: { kind: 'var', name: 'sso_wage_ceiling' },
        },
        rate: { kind: 'var', name: 'sso_employee_rate' },
      },
      ceiling: { kind: 'var', name: 'sso_contribution_ceiling' },
    },
    affectsNetPay: true,
    taxable: false,
    socialSecurityBase: false,
    providentFundBase: false,
    employerOnly: false,
    displayOrder: 50,
    ...HALF_UP_2,
  },
  {
    code: 'SOCIAL_SECURITY_EMPLOYER',
    name: 'ประกันสังคม (นายจ้าง)',
    category: 'EMPLOYER_CONTRIBUTION',
    calculationType: 'PERCENTAGE',
    formula: {
      kind: 'cap',
      value: {
        kind: 'multiply',
        money: {
          kind: 'cap',
          value: { kind: 'item', code: 'SALARY' },
          ceiling: { kind: 'var', name: 'sso_wage_ceiling' },
        },
        rate: { kind: 'var', name: 'sso_employer_rate' },
      },
      ceiling: { kind: 'var', name: 'sso_contribution_ceiling' },
    },
    affectsNetPay: false,
    taxable: false,
    socialSecurityBase: false,
    providentFundBase: false,
    employerOnly: true,
    displayOrder: 51,
    ...HALF_UP_2,
  },
  {
    code: 'PROVIDENT_FUND_EMPLOYEE',
    name: 'กองทุนสำรองเลี้ยงชีพ (ลูกจ้าง)',
    category: 'DEDUCTION',
    calculationType: 'PERCENTAGE',
    formula: {
      kind: 'multiply',
      money: { kind: 'item', code: 'SALARY' },
      rate: { kind: 'var', name: 'pf_employee_rate' },
    },
    affectsNetPay: true,
    taxable: false,
    socialSecurityBase: false,
    providentFundBase: false,
    employerOnly: false,
    displayOrder: 52,
    ...HALF_UP_2,
  },
  {
    code: 'WITHHOLDING_TAX',
    name: 'ภาษีหัก ณ ที่จ่าย',
    category: 'DEDUCTION',
    calculationType: 'FORMULA',
    /**
     * ประมาณการภาษีทั้งปีแล้วหารจำนวนงวดที่เหลือ
     *
     * ต่างจากระบบเดิมที่คูณ 12 เสมอและหาร 12 เสมอ (spec §3.3 P5, G6–G9)
     * ทุกค่าคงที่มาจาก rule set: ค่าใช้จ่าย ลดหย่อน และขั้นบันได
     */
    formula: {
      kind: 'divide',
      money: {
        kind: 'floor_at',
        value: {
          kind: 'bracket',
          value: {
            kind: 'subtract',
            left: {
              kind: 'subtract',
              left: { kind: 'var', name: 'estimated_annual_income' },
              right: {
                kind: 'cap',
                value: {
                  kind: 'multiply',
                  money: { kind: 'var', name: 'estimated_annual_income' },
                  rate: { kind: 'var', name: 'pit_expense_rate' },
                },
                ceiling: { kind: 'var', name: 'pit_expense_ceiling' },
              },
            },
            right: { kind: 'var', name: 'pit_total_allowance' },
          },
          brackets: [],
        },
        minimum: { kind: 'money', value: '0' },
      },
      rate: { kind: 'var', name: 'remaining_periods' },
    },
    affectsNetPay: true,
    taxable: false,
    socialSecurityBase: false,
    providentFundBase: false,
    employerOnly: false,
    displayOrder: 60,
    ...HALF_UP_2,
  },
  {
    code: 'OTHER_DEDUCTION',
    name: 'รายการหักอื่น',
    category: 'DEDUCTION',
    calculationType: 'MANUAL',
    formula: null,
    affectsNetPay: true,
    taxable: false,
    socialSecurityBase: false,
    providentFundBase: false,
    employerOnly: false,
    displayOrder: 70,
    ...HALF_UP_2,
  },
];

/**
 * ชุดกฎร่าง — ตัวเลขคัดลอกมาจากระบบเดิมเพื่อให้ dev มีอะไรทดลอง
 * **ทุกชุดเป็น DRAFT และ publish ไม่ได้** จนกว่าจะมีลายเซ็นตาม spec §9.5
 */
export const REFERENCE_RULE_DRAFTS: readonly StatutoryRuleSet[] = [
  {
    id: 'draft-sso',
    jurisdiction: 'TH',
    ruleType: 'TH_SOCIAL_SECURITY',
    version: 'DRAFT-legacy-copy',
    status: 'DRAFT',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    parameters: {
      sso_employee_rate: '0.05',
      sso_employer_rate: '0.05',
      sso_wage_ceiling: '15000.00',
      sso_contribution_ceiling: '750.00',
    },
    formulas: {},
    sourceReference: '',
    approvedBy: null,
    approvedAt: null,
    goldenTestsPassed: false,
  },
  {
    id: 'draft-ot',
    jurisdiction: 'TH',
    ruleType: 'OT_MULTIPLIER',
    version: 'DRAFT-legacy-copy',
    status: 'DRAFT',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    parameters: {
      ot_workday_multiplier: '1.5',
      ot_rest_day_multiplier: '1.0',
      ot_holiday_multiplier: '3.0',
    },
    formulas: {},
    sourceReference: '',
    approvedBy: null,
    approvedAt: null,
    goldenTestsPassed: false,
  },
  {
    id: 'draft-pit',
    jurisdiction: 'TH',
    ruleType: 'TH_PIT_WITHHOLDING',
    version: 'DRAFT-legacy-copy',
    status: 'DRAFT',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    parameters: {
      pit_expense_rate: '0.5',
      pit_expense_ceiling: '100000.00',
      pit_total_allowance: '60000.00',
    },
    formulas: {},
    sourceReference: '',
    approvedBy: null,
    approvedAt: null,
    goldenTestsPassed: false,
  },
];
