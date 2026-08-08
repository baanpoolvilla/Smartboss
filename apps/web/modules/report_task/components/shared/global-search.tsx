"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/modules/report_task/components/ui/command";
import { navItems } from "@/modules/report_task/lib/nav-config";
import { users, getDepartment, canManage } from "@/modules/report_task/data/mock";
import { useTaskStore } from "@/modules/report_task/store/task-store";
import { useIdentityStore } from "@/modules/report_task/store/identity-store";
import { useTaskBoardIntentStore } from "@/modules/report_task/store/task-board-intent-store";
import { useDashboardFilterStore } from "@/modules/report_task/store/dashboard-filter-store";
import { statusMeta, priorityMeta } from "@/modules/report_task/lib/task-meta";
import { canSeeTask } from "@/modules/report_task/lib/permissions";
import { cn } from "@/modules/report_task/lib/utils";
import { CircleUser } from "lucide-react";

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const tasks = useTaskStore((s) => s.tasks);
  const viewingAsUserId = useIdentityStore((s) => s.viewingAsUserId);
  const isHead = canManage(viewingAsUserId);
  const visibleNavItems = navItems.filter((item) => !item.managerOnly || isHead);
  const setOpenTask = useTaskBoardIntentStore((s) => s.setOpenTask);
  const setPersonId = useDashboardFilterStore((s) => s.setPersonId);

  // Cap the task list so the palette stays snappy; cmdk filters within these.
  // A non-head only ever searches into their own tasks (see canSeeTask).
  const taskList = useMemo(
    () => tasks.filter((t) => canSeeTask(t, viewingAsUserId)).slice(0, 60),
    [tasks, viewingAsUserId]
  );

  function go(fn: () => void) {
    onOpenChange(false);
    fn();
  }

  function openTask(taskId: string) {
    go(() => {
      setOpenTask(taskId);
      router.push("/tasks");
    });
  }

  function openPerson(personId: string) {
    go(() => {
      setPersonId(personId);
      router.push("/");
    });
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="sm:max-w-lg">
      <CommandInput placeholder="ค้นหางาน บุคคล หรือไปยังหน้า..." />
      <CommandList>
        <CommandEmpty>ไม่พบผลลัพธ์</CommandEmpty>

        <CommandGroup heading="ไปยังหน้า">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.href}
                value={`หน้า ${item.label}`}
                onSelect={() => go(() => router.push(item.href))}
              >
                <Icon className="text-[var(--ink-soft)]" />
                {item.label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandGroup heading="งาน">
          {taskList.map((t) => (
            <CommandItem key={t.id} value={`งาน ${t.title} ${t.id}`} onSelect={() => openTask(t.id)}>
              <span className={cn("h-2 w-2 rounded-full shrink-0", statusMeta[t.status].dot)} />
              <span className="truncate">{t.title}</span>
              <span className="ml-auto text-[10px] text-[var(--ink-soft)] shrink-0">{priorityMeta[t.priority].label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {isHead && (
          <CommandGroup heading="บุคคล">
            {users.map((u) => (
              <CommandItem key={u.id} value={`บุคคล ${u.name} ${u.role}`} onSelect={() => openPerson(u.id)}>
                <CircleUser className="text-[var(--ink-soft)]" />
                <span className="truncate">{u.name}</span>
                <span className="ml-auto text-[10px] text-[var(--ink-soft)] shrink-0 truncate max-w-[120px]">
                  {getDepartment(u.departmentId)?.name}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
