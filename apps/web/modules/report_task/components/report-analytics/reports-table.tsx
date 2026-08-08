"use client";

import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/modules/report_task/components/ui/table";
import { Avatar, AvatarFallback } from "@/modules/report_task/components/ui/avatar";
import { Badge } from "@/modules/report_task/components/ui/badge";
import { Progress } from "@/modules/report_task/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/modules/report_task/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/modules/report_task/components/ui/tooltip";
import { Button } from "@/modules/report_task/components/ui/button";
import { departments, users } from "@/modules/report_task/data/mock";
import { buildDepartmentReports, buildUserReports } from "@/modules/report_task/lib/reports";
import { useStickerStore } from "@/modules/report_task/store/sticker-store";
import { useReportTasks } from "@/modules/report_task/lib/report-filter";
import { downloadCsv } from "@/modules/report_task/lib/csv-export";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, SearchX } from "lucide-react";
import { cn } from "@/modules/report_task/lib/utils";
import { EmptyState } from "@/modules/report_task/components/shared/empty-state";
import type { ScoreBreakdown } from "@/modules/report_task/types";

interface ReportRow {
  id: string;
  name: string;
  subtitle: string;
  avatar: string;
  assignedTasks: number;
  completedTasks: number;
  lateTasks: number;
  completionRate: number;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  revisionCount: number;
}

function scoreBadgeClass(score: number) {
  if (score >= 80) return "bg-green-50 text-[var(--brand-green-dark)] border-green-200";
  if (score >= 60) return "bg-amber-50 text-[var(--chart-amber)] border-amber-200";
  return "bg-red-50 text-[var(--chart-red)] border-red-200";
}

export function ReportsTable() {
  const [scope, setScope] = useState<"member" | "department">("member");
  const [sorting, setSorting] = useState<SortingState>([{ id: "score", desc: true }]);
  const stickers = useStickerStore((s) => s.stickers);
  const tasks = useReportTasks();

  const memberRows: ReportRow[] = useMemo(
    () =>
      buildUserReports(tasks, stickers)
        .filter((r) => r.assignedTasks > 0)
        .map((r) => {
          const user = users.find((u) => u.id === r.userId)!;
          const dept = departments.find((d) => d.id === user.departmentId);
          return {
            id: r.userId,
            name: user.name,
            subtitle: dept?.name ?? "",
            avatar: user.avatar,
            assignedTasks: r.assignedTasks,
            completedTasks: r.completedTasks,
            lateTasks: r.lateTasks,
            completionRate: r.completionRate,
            score: r.score,
            scoreBreakdown: r.scoreBreakdown,
            revisionCount: r.revisionCount,
          };
        }),
    [tasks, stickers]
  );

  const departmentRows: ReportRow[] = useMemo(
    () =>
      buildDepartmentReports(tasks, stickers).map((r) => {
        const dept = departments.find((d) => d.id === r.departmentId)!;
        return {
          id: r.departmentId,
          name: dept.name,
          subtitle: `${r.assignedTasks} งาน`,
          avatar: dept.name.slice(0, 2),
          assignedTasks: r.assignedTasks,
          completedTasks: r.completedTasks,
          lateTasks: r.lateTasks,
          completionRate: r.completionRate,
          score: r.score,
          scoreBreakdown: r.scoreBreakdown,
          revisionCount: r.revisionCount,
        };
      }),
    [tasks, stickers]
  );

  const data = scope === "member" ? memberRows : departmentRows;

  const columns = useMemo<ColumnDef<ReportRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: scope === "member" ? "รายบุคคล" : "แผนก",
        cell: ({ row }) => (
          <div className="flex items-center gap-2.5">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="text-[10px] bg-[var(--accent)] text-[var(--brand-green-dark)]">
                {row.original.avatar}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="font-medium truncate">{row.original.name}</p>
              <p className="text-xs text-[var(--ink-soft)] truncate">{row.original.subtitle}</p>
            </div>
          </div>
        ),
      },
      { accessorKey: "assignedTasks", header: "มอบหมาย" },
      { accessorKey: "completedTasks", header: "เสร็จสิ้น" },
      {
        accessorKey: "lateTasks",
        header: "ล่าช้า",
        cell: ({ getValue }) => {
          const v = getValue<number>();
          return <span className={cn(v > 0 && "text-[var(--chart-red)] font-medium")}>{v}</span>;
        },
      },
      {
        accessorKey: "completionRate",
        header: "อัตราความสำเร็จ",
        cell: ({ getValue }) => {
          const v = getValue<number>();
          return (
            <div className="flex items-center gap-2 min-w-[120px]">
              <Progress value={v} className="h-1.5" />
              <span className="text-xs tabular-nums w-9 shrink-0">{v}%</span>
            </div>
          );
        },
      },
      { accessorKey: "revisionCount", header: "แก้ไขกำหนด" },
      {
        accessorKey: "score",
        header: "คะแนน",
        cell: ({ row }) => {
          const v = row.original.score;
          const b = row.original.scoreBreakdown;
          return (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Badge variant="outline" className={cn("tabular-nums font-semibold cursor-help", scoreBadgeClass(v))}>
                    {v}
                  </Badge>
                }
              />
              <TooltipContent className="text-xs space-y-0.5">
                <p>ฐานจากอัตราความสำเร็จ: {b.base}</p>
                {b.latePenalty > 0 && <p>หักงานล่าช้า: −{b.latePenalty}</p>}
                {b.revisionPenalty > 0 && <p>หักแก้ไขกำหนดส่ง: −{b.revisionPenalty}</p>}
                {b.manualPenalty > 0 && <p>หักคะแนนเลยกำหนด (ดุลยพินิจ): −{b.manualPenalty}</p>}
                {b.stickerAdjustment !== 0 && (
                  <p>สติกเกอร์: {b.stickerAdjustment > 0 ? `+${b.stickerAdjustment}` : b.stickerAdjustment}</p>
                )}
                <p className="font-semibold pt-0.5 border-t border-white/20 mt-1">รวม: {b.total}</p>
              </TooltipContent>
            </Tooltip>
          );
        },
      },
    ],
    [scope]
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  function exportCsv() {
    const headers = [
      scope === "member" ? "รายบุคคล" : "แผนก",
      scope === "member" ? "แผนก" : "จำนวนงาน",
      "มอบหมาย",
      "เสร็จสิ้น",
      "ล่าช้า",
      "อัตราความสำเร็จ (%)",
      "แก้ไขกำหนด",
      "คะแนน",
    ];
    const rows = table
      .getSortedRowModel()
      .rows.map((r) => [
        r.original.name,
        r.original.subtitle,
        r.original.assignedTasks,
        r.original.completedTasks,
        r.original.lateTasks,
        r.original.completionRate,
        r.original.revisionCount,
        r.original.score,
      ]);
    downloadCsv(`รายงาน-${scope === "member" ? "รายบุคคล" : "รายแผนก"}.csv`, headers, rows);
  }

  return (
    <div className="rounded-xl border border-[var(--line)] bg-white">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
        <div>
          <h3 className="font-semibold text-sm">รายงานผลการทำงาน</h3>
          <p className="text-xs text-[var(--ink-soft)] mt-0.5">ชี้ที่คะแนนเพื่อดูรายละเอียดการหัก/บวกคะแนน</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Tabs value={scope} onValueChange={(v) => v && setScope(v as "member" | "department")}>
            <TabsList>
              <TabsTrigger value="member">รายบุคคล</TabsTrigger>
              <TabsTrigger value="department">รายแผนก</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> ส่งออก CSV
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
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
                      aria-sort={sortDir === "asc" ? "ascending" : sortDir === "desc" ? "descending" : canSort ? "none" : undefined}
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
                <TableCell colSpan={table.getAllColumns().length} className="p-4">
                  <EmptyState icon={SearchX} title="ไม่พบข้อมูลตามตัวกรอง" description="ลองปรับหรือล้างตัวกรองด้านบน" className="border-0" />
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="whitespace-nowrap">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {table.getPageCount() > 1 && (
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-[var(--line)] text-xs text-[var(--ink-soft)]">
            <span>
              หน้า {table.getState().pagination.pageIndex + 1} จาก {table.getPageCount()} · {data.length} รายการ
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                aria-label="หน้าก่อนหน้า"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                aria-label="หน้าถัดไป"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
