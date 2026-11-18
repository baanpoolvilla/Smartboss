# Due-request approval chat room — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post due-date requests (Task, work order, work-order expense) as cards with approve/reject buttons into a per-approver system chat room "คำขออนุมัติ".

**Architecture:** Reuse chat message kind `"task"` (already counted unread, never pops, never pushed) with a new `approval` block in `meta`. Room id `approve-<userId>`, created like `clock-<userId>`. The card's status is read live from the real request at hydrate time, so a decision made anywhere shows. Buttons call the existing decide paths only: `useTaskStore.decideDueDateRequest` (task store is mounted on the chat page via ReportTaskLayout), `decideDueRequestAction`, `decideExpenseExtensionAction`.

**Tech Stack:** Next.js server actions, Prisma, zustand, node `tsx --test`.

**Spec:** docs/superpowers/specs/2026-11-18-due-request-approval-chat-design.md

## Global Constraints
- No second approval path; no changes to bell notifications or who-can-approve rules.
- Card recipients = exactly the users who get the bell row for that request today (Boss only for own items / Boss-only items).
- Card posting never throws into the request flow.
- WO and expense reject require a reason (existing rule); Task reject note optional.
- Selected/primary UI uses navy `--brand-navy`, not green. New UI text via `ceoTitle()` where Boss is named.
- `tsc` clean before every commit; commit straight to main.

## Review Focus
- Request replaced by a new one → old card shows "ยกเลิกแล้ว", buttons gone (live status: request not pending).
- Approver clicks after someone else decided → server/store refuses; card refreshes to decided state, toast says so.
- Task request saved from browser after the notification row → card poster retries reading the task (like postTaskCard) and skips if no pending request found.
- Viewer is not an allowed decider (e.g. room owner changed role) → buttons hidden (server action re-checks).
- Group request → "อนุมัติทั้ง N คน" applies request.forUserIds; "เลือกบางคน" links to the page.

---

### Task 1: Types + live status helper
**Files:** Modify `modules/chat/types.ts`; Create `modules/chat/lib/approval.ts`; Test `modules/chat/__tests__/approval.test.ts`
- Add `APPROVE_CHANNEL_PREFIX = "approve-"`, `isApproveChannelId(id)`.
- Add `ChatApprovalInfo { source: "task"|"work_order"|"expense"; requestId; requesterId; previousDate: string|null; newDate: string; reason: string; forCount?: number; memberCount?: number; status: "pending"|"approved"|"rejected"|"cancelled"; decidedBy?: string; decidedAt?: string; decisionNote?: string }` and `ChatTaskCard.approval?`.
- `lib/approval.ts` (pure): `taskRequestStatus(data: unknown, requestId): Pick<ChatApprovalInfo,"status"|"decidedBy"|"decidedAt"|"decisionNote"> | null` reading `data.dueDateRequests`; `daysBetween(a,b)`.
- Tests: pending/approved found; unknown id → null; malformed data → null; daysBetween("2026-11-17","2026-11-24") = 7.

### Task 2: Server — room + post + hydrate
**Files:** Create `modules/chat/data/approval-cards.ts`; Modify `modules/chat/data/serialize.ts`, `modules/chat/data/channels.ts` (rename/leave guards at :584/:627), `modules/chat/lib/format.ts` (preview "📅 …").
- `ensureApprovalChannel(orgId, userId)`; `postApprovalCard(orgId, { approverId, authorId(requester), clientId, body, card })` — insert kind "task", broadcast to approver only, swallow P2002/any error.
- `postTaskDueRequestCards(orgId, { taskId, requesterId, approverId })` — read reportTask (retry ~6 s) → newest pending request by requester → card.
- `postWorkOrderDueRequestCards(orgId, { requestId, approverIds, source })`.
- serialize: parse `approval`; batch live lookup — WO table by ids, reportTask.data by taskIds — overwrite status fields.

### Task 3: Hooks
**Files:** `modules/report_task/lib/db/org-store.ts` (kind `task_due_request` + message contains "ขอเลื่อนกำหนดส่งงาน" → postTaskDueRequestCards for n.userId), `app/(shell)/maintenance/work-orders/due-request-actions.ts` (after notify, approvers set), `expense-deadline-actions.ts` (CEO ids).

### Task 4: UI
**Files:** Create `modules/chat/components/approval-card.tsx`; Modify `task-card.tsx` (delegate when `card.approval`), `channel-list.tsx` (calendar icon for approve- room).
- Pending + can decide: อนุมัติ (navy) / ไม่อนุมัติ (opens note dialog; required for WO/expense) / ดูรายละเอียด (group: "อนุมัติทั้ง N คน" + "เลือกบางคน").
- Task decide: `useTaskStore.getState().decideDueDateRequest(taskId, requestId, me, approve, note)`; check request still pending in store first.
- Decided/cancelled: grey header with result + who + time.
- Verify locally: request on a task as staff → card appears in approver room; approve in chat → board red card gone, comment ✅.
