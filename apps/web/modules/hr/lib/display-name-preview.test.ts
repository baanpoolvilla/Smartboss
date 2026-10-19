import { describe, expect, it } from "vitest";
import { composeDisplayName, DISPLAY_NAME_FORMATS } from "@workforce/domain";

import { previewDisplayName } from "./display-name-preview";

describe("ตัวอย่างชื่อในหน้าบัญชีของฉัน ตรงกับสูตรจริงของระบบบุคคล", () => {
  const cases = [
    { firstName: "Thunchanok", lastName: "Srisuk", preferredName: "Nam" },
    { firstName: "Katawut", lastName: "Nantaprom", preferredName: "" },
    { firstName: "", lastName: "Nantaprom", preferredName: "ภีม" },
    { firstName: "  Pacharapol ", lastName: " X ", preferredName: " กาย " },
  ];
  for (const format of DISPLAY_NAME_FORMATS) {
    it(format, () => {
      for (const c of cases) {
        expect(previewDisplayName(c.firstName, c.lastName, c.preferredName, format)).toBe(composeDisplayName(c, format));
      }
    });
  }
  it("Nam + Thunchanok ในรูปแบบ ชื่อเล่น-ชื่อจริง = Nam-Thunchanok", () => {
    expect(previewDisplayName("Thunchanok", "Srisuk", "Nam", "NICK_FIRST")).toBe("Nam-Thunchanok");
  });
});
