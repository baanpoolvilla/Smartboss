import {
  Umbrella,
  Thermometer,
  Briefcase,
  House,
  Plane,
  Heart,
  Coffee,
  Baby,
  Stethoscope,
  GraduationCap,
  Sun,
  Tent,
  Ban,
  type LucideIcon,
} from "lucide-react";

import { chartColors } from "@/modules/report_task/lib/chart-colors";

/** Preset icons a leave type can use — keyed by a stable name stored per type. */
export const leaveIconRegistry: Record<string, LucideIcon> = {
  umbrella: Umbrella,
  thermometer: Thermometer,
  briefcase: Briefcase,
  house: House,
  plane: Plane,
  heart: Heart,
  coffee: Coffee,
  baby: Baby,
  stethoscope: Stethoscope,
  graduation: GraduationCap,
  sun: Sun,
  tent: Tent,
  ban: Ban,
};

export const leaveIconNames = Object.keys(leaveIconRegistry);

export function leaveIconOf(name: string | undefined): LucideIcon {
  return (name && leaveIconRegistry[name]) || Umbrella;
}

/**
 * Fixed color+icon for HR's standard leave-type names (STANDARD_LEAVE_TYPES
 * in hr/actions.ts) — asked for by name so "ลาป่วย" always reads red with a
 * thermometer everywhere, rather than whatever color/icon it happened to
 * land on by order of first appearance that day (the old cycling behavior,
 * kept below as the fallback for a custom type an admin added themselves).
 */
const LEAVE_TYPE_PRESETS: Record<string, { color: string; icon: string }> = {
  "ลาป่วย": { color: chartColors.red, icon: "thermometer" },
  "ลาพักร้อน": { color: chartColors.orange, icon: "sun" },
  "ลากิจ": { color: chartColors.teal, icon: "briefcase" },
  "ลาไม่รับค่าจ้าง": { color: chartColors.violet, icon: "ban" },
};

export function leaveTypePresetFor(name: string): { color: string; icon: string } | undefined {
  return LEAVE_TYPE_PRESETS[name.trim()];
}
