import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Picks one of `items` deterministically from today's date — same pick for
 * everyone all day (no flicker on re-render, no two people seeing different
 * copy), but rotates day to day instead of always showing item 0. Used for
 * "ตัวปัญหาหลัก" tip copy so repeat visits don't read the exact same sentence
 * every single time. */
export function pickDaily<T>(items: readonly T[]): T {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  return items[dayOfYear % items.length]!;
}
