import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  company: true,
  request: true,
  perm: false,
  companyKeys: [] as string[],
  requestKeys: [] as string[],
}));

vi.mock("@smartboss/auth", () => ({ hasPermission: () => h.perm }));
vi.mock("@/modules/maintenance/permissions", () => ({ MAINT_PERMS: { expenseView: "v", expenseManage: "m" } }));
vi.mock("@/modules/company-files/lib/serve-access", () => ({
  canServeCompanyFileKey: async (_o: string, _u: string, key: string) => {
    h.companyKeys.push(key);
    return h.company;
  },
}));
vi.mock("@/modules/requests/lib/serve-access", () => ({
  canServeRequestFileKey: async (_o: string, _s: unknown, key: string) => {
    h.requestKeys.push(key);
    return h.request;
  },
}));

import type { Session } from "@smartboss/auth";
import { canServeOwnedFileKey } from "@/lib/file-access";

const session = { orgId: "org", userId: "u1" } as unknown as Session;

describe("canServeOwnedFileKey", () => {
  beforeEach(() => {
    h.company = true;
    h.request = true;
    h.perm = false;
    h.companyKeys = [];
    h.requestKeys = [];
  });

  it("รูปหน้าแรกของไฟล์คลังกลางตรวจสิทธิ์ด้วยไฟล์ต้นทาง ไม่ใช่ key ของรูป", async () => {
    h.company = false;
    expect(await canServeOwnedFileKey(session, "org/company-files/a.pdf.thumb.png")).toBe(false);
    expect(h.companyKeys).toEqual(["org/company-files/a.pdf"]);
  });

  it("รูปหน้าแรกของใบเบิกจ่ายตรวจสิทธิ์ด้วยไฟล์ต้นทาง", async () => {
    h.request = false;
    expect(await canServeOwnedFileKey(session, "org/requests/u2/a.pdf.thumb.png")).toBe(false);
    expect(h.requestKeys).toEqual(["org/requests/u2/a.pdf"]);
  });

  it("ไฟล์จริงยังตรวจเหมือนเดิม", async () => {
    expect(await canServeOwnedFileKey(session, "org/company-files/a.pdf")).toBe(true);
    expect(h.companyKeys).toEqual(["org/company-files/a.pdf"]);
  });

  it("ใบเสร็จงานซ่อมต้องมีสิทธิ์ดูค่าใช้จ่าย", async () => {
    expect(await canServeOwnedFileKey(session, "org/maintenance/receipts/a.jpg")).toBe(false);
    h.perm = true;
    expect(await canServeOwnedFileKey(session, "org/maintenance/receipts/a.jpg")).toBe(true);
  });

  it("โมดูลอื่นผ่านระดับบริษัท", async () => {
    expect(await canServeOwnedFileKey(session, "org/chat/a.pdf.thumb.png")).toBe(true);
    expect(await canServeOwnedFileKey(session, "org/report-task/a.pdf")).toBe(true);
  });
});
