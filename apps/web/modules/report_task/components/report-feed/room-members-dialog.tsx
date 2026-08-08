"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/modules/report_task/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/modules/report_task/components/ui/table";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Checkbox } from "@/modules/report_task/components/ui/checkbox";
import { Input } from "@/modules/report_task/components/ui/input";
import { Button } from "@/modules/report_task/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/modules/report_task/components/ui/select";
import { departments, getDepartment, getUser, users } from "@/modules/report_task/data/mock";
import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { topicModeOf } from "@/modules/report_task/lib/report-topic-membership";
import type { ReportTopic } from "@/modules/report_task/store/report-feed-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";
import { ArrowDown, ArrowUp, ArrowUpDown, Search, Users } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string;
  departmentName: string;
}

/**
 * Compact summary — the settings page should never grow taller because a
 * room has more members; a room with thousands of people would otherwise
 * turn this section into an endless chip wall. Only a count and a button
 * into the real management surface (RoomMembersDialog) live here.
 */
export function RoomMembersSummaryCard({
  topic,
  canManage,
  onManage,
}: {
  topic: ReportTopic;
  canManage: boolean;
  onManage: () => void;
}) {
  const memberCount = useMemo(() => users.filter((u) => canSeeReportTopic(topic.visibility, u.id)).length, [topic.visibility]);
  const exemptCount = topic.visibility?.exemptUserIds?.length ?? 0;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-white p-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-10 w-10 shrink-0 rounded-full bg-[var(--accent)] text-[var(--brand-green-dark)] flex items-center justify-center">
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">สมาชิกที่มีสิทธิ์เข้าห้อง</p>
          <p className="text-2xl font-bold tabular-nums leading-tight">
            {memberCount} <span className="text-sm font-normal text-[var(--ink-soft)]">คน</span>
          </p>
          <p className="text-xs text-[var(--ink-soft)]">
            มีสมาชิกทั้งหมดที่สามารถเข้าห้องนี้ได้
            {exemptCount > 0 && ` · ยกเว้น ${exemptCount} คนจากการส่ง`}
          </p>
        </div>
      </div>
      {/* Same button, same dialog, every room — only the label and what's
          editable inside change with permission/mode. A room where nothing
          shows here (vs. a plain viewer elsewhere) is what actually confuses
          people, not a "ดูสมาชิก"/"จัดการสมาชิก" label difference. */}
      <Button onClick={onManage} variant={canManage ? "default" : "outline"} className="shrink-0">
        <Users className="h-4 w-4" /> {canManage ? "จัดการสมาชิก" : "ดูสมาชิก"}
      </Button>
    </div>
  );
}

/**
 * The actual management surface — a searchable, filterable, sortable roster
 * in a dialog (full-screen on mobile) instead of an ever-growing list on the
 * page. Edits are staged locally and only committed on Save, so closing or
 * cancelling never half-applies a change.
 *
 * This mock dataset only has ~15 people and everything lives in a client
 * Zustand store (no API to page against), so this deliberately renders the
 * filtered rows as a plain list rather than pulling in a virtualizer or a
 * data-fetching layer — that machinery would be solving a problem this app
 * doesn't have yet. The row rendering below is a single `.map()` over the
 * already-filtered array, which is exactly the shape you'd hand to
 * @tanstack/react-virtual later if this ever backs a real multi-thousand-person
 * directory; nothing here would need restructuring to add it.
 */
export function RoomMembersDialog({
  open,
  onOpenChange,
  topic,
  updateTopicSettings,
  canManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: ReportTopic;
  updateTopicSettings: (id: string, patch: Partial<ReportTopic>) => void;
  canManage: boolean;
}) {
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const mode = topicModeOf(topic.visibility);
  // The same dialog opens for every room regardless of mode/permission —
  // "open"/"manager" rooms and viewers who can't edit this room get a
  // read-only browse of who currently has access (still searchable/sortable,
  // since that's just as useful for a big roster); only department/person
  // rooms with edit rights get the checkbox column and Save.
  const editable = canManage && (mode === "department" || mode === "person");

  // Members who belong via the room's selected department(s) — locked in
  // this dialog (changing them means changing the department list itself,
  // back on the settings page) rather than silently dropping department
  // access through an unrelated checkbox.
  const lockedIds = useMemo(() => {
    if (mode !== "department") return new Set<string>();
    const deptIds = new Set(topic.visibility?.departmentIds ?? []);
    return new Set(users.filter((u) => u.departmentId && deptIds.has(u.departmentId)).map((u) => u.id));
  }, [mode, topic.visibility?.departmentIds]);

  const [checked, setChecked] = useState<Set<string>>(new Set());
  // Members who can stay in the room but are excluded from the posting
  // schedule (mustReportToTopic) — always a subset of `checked`.
  const [exempt, setExempt] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);

  // Re-seed the draft from the room's current membership every time the
  // dialog opens, so a previous cancelled edit never leaks into the next.
  useEffect(() => {
    if (!open) return;
    const current = users.filter((u) => !u.isOwner && canSeeReportTopic(topic.visibility, u.id)).map((u) => u.id);
    setChecked(new Set(current));
    setExempt(new Set(topic.visibility?.exemptUserIds ?? []));
    setSearch("");
    setDeptFilter("all");
  }, [open, topic.visibility]);

  const rows: MemberRow[] = useMemo(
    () =>
      users
        // Editable: the full roster to check/uncheck against, minus the
        // owner (who always has access, nothing to toggle). Read-only:
        // exactly who currently has access — including the owner, since
        // this view is just "who's in", not "who could be added".
        .filter((u) => (editable ? !u.isOwner : canSeeReportTopic(topic.visibility, u.id)))
        .map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          avatar: u.avatar,
          departmentName: getDepartment(u.departmentId)?.name ?? "—",
        })),
    [editable, topic.visibility]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (deptFilter !== "all") {
        const u = users.find((usr) => usr.id === r.id);
        if (u?.departmentId !== deptFilter) return false;
      }
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.role.toLowerCase().includes(q);
    });
  }, [rows, search, deptFilter]);

  const columns = useMemo<ColumnDef<MemberRow>[]>(() => {
    const nameEtc: ColumnDef<MemberRow>[] = [
      {
        accessorKey: "name",
        header: "ชื่อ",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">{row.original.avatar}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-medium truncate flex items-center gap-1.5">
                {row.original.name}
                {/* Read-only view has no checkbox column to show this via —
                    the committed visibility (not the editable draft) is the
                    only place to read it from here. */}
                {!editable && topic.visibility?.exemptUserIds?.includes(row.original.id) && (
                  <span className="shrink-0 text-[10px] font-medium text-[var(--ink-soft)] bg-[var(--bg-soft)] rounded-full px-1.5 py-0.5">
                    ยกเว้นส่ง
                  </span>
                )}
              </p>
              <p className="text-xs text-[var(--ink-soft)] truncate">{row.original.email}</p>
            </div>
          </div>
        ),
      },
      { id: "department", accessorKey: "departmentName", header: "แผนก" },
      { id: "role", accessorKey: "role", header: "ตำแหน่ง", enableSorting: false },
    ];
    if (!editable) return nameEtc;
    const selectCol: ColumnDef<MemberRow> = {
      id: "select",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const id = row.original.id;
        const locked = lockedIds.has(id);
        return (
          <Checkbox
            checked={checked.has(id)}
            disabled={locked}
            onCheckedChange={() =>
              setChecked((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                  next.delete(id);
                  // Can't be exempt from reporting in a room you're not even
                  // a member of anymore.
                  setExempt((ex) => {
                    if (!ex.has(id)) return ex;
                    const nextEx = new Set(ex);
                    nextEx.delete(id);
                    return nextEx;
                  });
                } else {
                  next.add(id);
                }
                return next;
              })
            }
            aria-label={`เลือก ${row.original.name}`}
          />
        );
      },
    };
    const exemptCol: ColumnDef<MemberRow> = {
      id: "exempt",
      header: "ยกเว้นส่ง",
      enableSorting: false,
      cell: ({ row }) => {
        const id = row.original.id;
        const isMember = checked.has(id);
        return (
          <Checkbox
            checked={exempt.has(id)}
            disabled={!isMember}
            title={isMember ? "อยู่ในห้องได้ แต่ไม่ถูกนับในสถิติตรงเวลา/สาย/ไม่ส่ง" : "ต้องเป็นสมาชิกก่อนถึงจะยกเว้นได้"}
            onCheckedChange={() =>
              setExempt((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            aria-label={`ยกเว้น ${row.original.name} จากการส่งรายงาน`}
          />
        );
      },
    };
    return [selectCol, ...nameEtc, exemptCol];
  }, [editable, checked, exempt, lockedIds, topic.visibility]);

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const selectedCount = checked.size;
  const canSave = mode === "department" || selectedCount > 0; // person-mode room can't be saved down to zero people

  function handleSave() {
    // Whoever couldn't see this room a moment ago but is checked now is
    // newly granted access — worth a notification, same "someone gave you
    // access to something" pattern as a meeting-attendee tag elsewhere.
    // Diffed against the room's visibility as it stood before this save, not
    // against the initial `checked` snapshot, so it still holds even if this
    // dialog's own re-seeding effect ran again mid-edit.
    const newlyAdded = [...checked].filter((id) => !canSeeReportTopic(topic.visibility, id));
    // Defensive intersect with `checked`, not just the raw draft — the same
    // "can't be exempt if you're not a member" rule the checkbox already
    // enforces interactively.
    const exemptUserIds = [...exempt].filter((id) => checked.has(id));
    if (mode === "department") {
      const extraUserIds = [...checked].filter((id) => !lockedIds.has(id));
      updateTopicSettings(topic.id, { visibility: { departmentIds: topic.visibility?.departmentIds ?? [], extraUserIds, exemptUserIds } });
    } else if (mode === "person") {
      if (checked.size === 0) return;
      updateTopicSettings(topic.id, { visibility: { userIds: [...checked], exemptUserIds } });
    }
    if (newlyAdded.length > 0) {
      const actorName = getUser(viewingAsUserId)?.name ?? "มีคน";
      useNotificationStore.getState().notifyMany(newlyAdded, viewingAsUserId, `${actorName} เพิ่มคุณเข้าห้อง Report "${topic.name}"`);
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] max-sm:!inset-0 max-sm:!top-0 max-sm:!left-0 max-sm:!h-full max-sm:!max-h-full max-sm:!w-full max-sm:!max-w-full max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-3 border-b border-[var(--line)] gap-3">
          <DialogTitle>สมาชิกทั้งหมด ({rows.length})</DialogTitle>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--ink-soft)]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อ, อีเมล, ตำแหน่ง..."
                className="pl-8"
              />
            </div>
            <Select value={deptFilter} onValueChange={(v) => v && setDeptFilter(v)}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue>{deptFilter === "all" ? "ทุกแผนก" : getDepartment(deptFilter)?.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ทุกแผนก</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => {
                    const sortDir = header.column.getIsSorted();
                    const canSort = header.column.getCanSort();
                    return (
                      <TableHead
                        key={header.id}
                        className={cn("select-none whitespace-nowrap", canSort && "cursor-pointer")}
                        onClick={header.column.getToggleSortingHandler()}
                        role={canSort ? "button" : undefined}
                        tabIndex={canSort ? 0 : undefined}
                        onKeyDown={
                          canSort
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  header.column.getToggleSortingHandler()?.(e);
                                }
                              }
                            : undefined
                        }
                      >
                        <span className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sortDir === "asc" && <ArrowUp className="h-3 w-3" />}
                          {sortDir === "desc" && <ArrowDown className="h-3 w-3" />}
                          {!sortDir && canSort && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                        </span>
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="text-center text-sm text-[var(--ink-soft)] py-8">
                    ไม่พบคนที่ค้นหา
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="px-4 py-3">{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="!mx-0 !mb-0 rounded-b-none justify-between sm:justify-between items-center">
          <p className="text-sm text-[var(--ink-soft)]">
            {editable ? `เลือกแล้ว ${selectedCount} คน` : `ทั้งหมด ${filteredRows.length} คน`}
          </p>
          {editable ? (
            <div className="flex gap-2">
              <Button data-tour="member-dialog-close" variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
              <Button onClick={handleSave} disabled={!canSave}>บันทึก</Button>
            </div>
          ) : (
            <Button data-tour="member-dialog-close" variant="outline" onClick={() => onOpenChange(false)}>ปิด</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
