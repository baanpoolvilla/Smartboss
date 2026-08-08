import { create } from "zustand";
import { useEmployeeStore } from "@/modules/report_task/store/employee-store";

interface IdentityStore {
  viewingAsUserId: string;
  setViewingAs: (userId: string) => void;
}

// Defaults to the owner (falling back to whoever's first) rather than a
// fixed "usr-01" — departments/employees are now editable, so the seed
// employee that used to sit at index 0 isn't guaranteed to exist or make
// sense as a default once an org has been customized.
function defaultViewingAsUserId(): string {
  const employees = useEmployeeStore.getState().employees;
  return employees.find((u) => u.isOwner)?.id ?? employees[0]?.id ?? "";
}

export const useIdentityStore = create<IdentityStore>((set) => ({
  viewingAsUserId: defaultViewingAsUserId(),
  setViewingAs: (userId) => set({ viewingAsUserId: userId }),
}));
