import type { StateStorage } from "zustand/middleware";

/**
 * `localStorage`/`sessionStorage` wrapped so a write failure never crashes
 * the caller. iOS Safari private-mode browsing sets quota to 0 — `getItem`
 * still works, but `setItem` throws `QuotaExceededError` synchronously.
 * zustand's `persist` middleware calls `storage.setItem` directly from
 * inside `set()`/`api.setState()` with no try/catch of its own (see
 * `zustand/middleware/persist`), so that throw propagates straight up
 * through whatever store action the user just triggered — issue D. Data
 * simply won't survive a reload in that mode instead of taking the app down.
 */
function wrapStorage(getStorage: () => Storage): StateStorage {
  return {
    getItem: (name) => {
      try {
        return getStorage().getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        getStorage().setItem(name, value);
      } catch {
        // best-effort — the store keeps working in-memory for this session
      }
    },
    removeItem: (name) => {
      try {
        getStorage().removeItem(name);
      } catch {
        // ignore
      }
    },
  };
}

export const safeLocalStorage: StateStorage = wrapStorage(() => window.localStorage);
export const safeSessionStorage: StateStorage = wrapStorage(() => window.sessionStorage);
