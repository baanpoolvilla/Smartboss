"use client";

import { Printer } from "lucide-react";

import { outline } from "./ui";

export function PrintButton() {
  return (
    <button type="button" className={outline} onClick={() => window.print()}>
      <Printer className="h-4 w-4" aria-hidden="true" /> พิมพ์
    </button>
  );
}
