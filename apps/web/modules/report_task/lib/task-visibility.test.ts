import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isOwner, setSessionOwner } from "@/modules/report_task/lib/directory";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { useDepartmentStore } from "@/modules/report_task/store/department-store";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";
import type { Department, Task, User } from "@/modules/report_task/types";

/**
 * ใครเห็นงานไหนบนบอร์ด — isOwner ตัดสินทั้งหมด
 *   - CEO: ช่อง "เจ้าของบริษัท" ในรายชื่อพนักงานเปิด ⇒ ทุกงาน
 *   - IT (role ADMIN แต่ช่องเจ้าของถูกปิด): เฉพาะงานตัวเอง — เคยหลุดเห็นงานทุกคนเพราะเอา role ADMIN มาทับ
 *   - ผู้ดูแลระบบสูงสุด (SUPER_ADMIN): ทุกงานเสมอ ทั้งตอนไม่อยู่ในรายชื่อ และตอนอยู่แต่ช่องเจ้าของถูกปิด
 *   - หัวหน้าแผนก: งานตัวเอง + งานที่ติดแผนกตัวเอง
 *   - พนักงาน: เฉพาะงานที่ตัวเองรับ/สั่ง
 */
const CEO = "ceo";
const IT = "it";
const SA = "super-admin";
const HEAD = "head";
const STAFF = "staff";
const OTHER = "other";

const people: User[] = [
  { id: CEO, name: "CEO", email: "c@x", avatar: "C", role: "CEO", departmentId: "d-mgmt", isOwner: true },
  { id: IT, name: "IT", email: "i@x", avatar: "I", role: "ผู้ดูแลระบบ", departmentId: "d-it" },
  { id: HEAD, name: "Head", email: "h@x", avatar: "H", role: "หัวหน้า", departmentId: "d-hk" },
  { id: STAFF, name: "Staff", email: "s@x", avatar: "S", role: "พนักงาน", departmentId: "d-hk" },
  { id: OTHER, name: "Other", email: "o@x", avatar: "O", role: "พนักงาน", departmentId: "d-mkt" },
];

const depts = [
  { id: "d-hk", name: "แม่บ้าน", headId: HEAD },
  { id: "d-mkt", name: "การตลาด" },
  { id: "d-it", name: "IT" },
] as Department[];

const task = (id: string, assigneeIds: string[], assignedById: string, departmentIds: string[] = []) =>
  ({ id, assigneeIds, assignedById, departmentIds }) as Pick<Task, "assigneeIds" | "assignedById" | "departmentIds"> & {
    id: string;
  };

const board = [
  task("mine-it", [IT], CEO),
  task("others-mkt", [OTHER], CEO, ["d-mkt"]),
  task("hk", [STAFF], HEAD, ["d-hk"]),
  task("by-it", [OTHER], IT),
];

const visible = (viewer: string) => board.filter((t) => canSeeTask(t, viewer)).map((t) => t.id);

beforeEach(() => {
  useEmployeeStore.setState({ employees: people });
  useDepartmentStore.setState({ departments: depts });
  setSessionOwner(null);
});
afterEach(() => setSessionOwner(null));

describe("การมองเห็นงานบนบอร์ด", () => {
  it("CEO เห็นทุกงาน", () => {
    expect(visible(CEO)).toEqual(["mine-it", "others-mkt", "hk", "by-it"]);
  });

  it("IT (ADMIN ที่ปิดช่องเจ้าของ) เห็นแค่งานที่ตัวเองรับหรือสั่ง", () => {
    // layout ส่ง session owner เฉพาะ SUPER_ADMIN — IT ล็อกอินอยู่ก็ไม่ได้ตั้ง
    expect(isOwner(IT)).toBe(false);
    expect(visible(IT)).toEqual(["mine-it", "by-it"]);
  });

  it("ผู้ดูแลระบบสูงสุดที่ไม่อยู่ในรายชื่อพนักงาน เห็นทุกงาน", () => {
    setSessionOwner(SA);
    expect(visible(SA)).toHaveLength(board.length);
  });

  it("ผู้ดูแลระบบสูงสุดที่อยู่ในรายชื่อแต่ช่องเจ้าของถูกปิด ก็ยังเห็นทุกงาน", () => {
    useEmployeeStore.setState({
      employees: [...people, { id: SA, name: "SA", email: "sa@x", avatar: "S", role: "ผู้ดูแลระบบสูงสุด", departmentId: "" }],
    });
    setSessionOwner(SA);
    expect(visible(SA)).toHaveLength(board.length);
  });

  it("session owner ของผู้ดูแลระบบสูงสุดไม่ลามไปคนอื่น", () => {
    setSessionOwner(SA);
    expect(isOwner(IT)).toBe(false);
    expect(visible(STAFF)).toEqual(["hk"]);
  });

  it("หัวหน้าแผนกเห็นงานของแผนกตัวเอง ไม่เห็นแผนกอื่น", () => {
    expect(visible(HEAD)).toEqual(["hk"]);
  });

  it("พนักงานเห็นเฉพาะงานตัวเอง", () => {
    expect(visible(STAFF)).toEqual(["hk"]);
    expect(visible(OTHER)).toEqual(["others-mkt", "by-it"]);
  });
});
