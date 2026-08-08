import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * UI-only preferences for now — this app has no email-sending backend
 * (SMTP/provider) yet, so toggling these doesn't send anything. They persist
 * per-browser so the settings are ready to wire up the moment a real mail
 * service is connected, instead of everyone starting from scratch then.
 */
export interface EmailNotificationSettings {
  enabled: boolean;
  dueSoon: boolean;
  overdue: boolean;
  penalty: boolean;
  meetingInvite: boolean;
  assigned: boolean;
}

interface EmailNotificationSettingsStore {
  settings: EmailNotificationSettings;
  setEnabled: (enabled: boolean) => void;
  setCategory: (key: keyof Omit<EmailNotificationSettings, "enabled">, value: boolean) => void;
}

const defaultSettings: EmailNotificationSettings = {
  enabled: false,
  dueSoon: true,
  overdue: true,
  penalty: true,
  meetingInvite: true,
  assigned: true,
};

export const useEmailNotificationSettingsStore = create<EmailNotificationSettingsStore>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      setEnabled: (enabled) => set((s) => ({ settings: { ...s.settings, enabled } })),
      setCategory: (key, value) => set((s) => ({ settings: { ...s.settings, [key]: value } })),
    }),
    { name: "eb-email-notification-settings", skipHydration: true }
  )
);
