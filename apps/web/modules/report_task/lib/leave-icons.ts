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
  type LucideIcon,
} from "lucide-react";

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
};

export const leaveIconNames = Object.keys(leaveIconRegistry);

export function leaveIconOf(name: string | undefined): LucideIcon {
  return (name && leaveIconRegistry[name]) || Umbrella;
}
