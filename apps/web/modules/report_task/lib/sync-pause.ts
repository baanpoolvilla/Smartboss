"use client";

/**
 * A global "don't pull server data in right now" latch for ServerStoreSync's
 * background poll.
 *
 * The poll already skips a tick while there's an unsaved *store* edit in
 * flight (see server-store-sync.tsx), but that only covers edits that have
 * already been written to a Zustand store. Some surfaces deliberately hold a
 * local working copy instead and write nothing until the user confirms — the
 * topic sidebar's drag reorder stages into `pendingTopics` and only calls
 * moveTopic/updateTopicSettings on "เสร็จ".
 *
 * From the sync layer that looks like "nobody is editing," so a poll would
 * happily land mid-edit, replace `topics`/`posts` with fresh arrays, and
 * re-render the whole feed underneath the user. During a native HTML5 drag
 * that's fatal: the dragged row's DOM node gets replaced, the browser never
 * fires `dragend` on the original element, and the drag is stuck with the row
 * dimmed until a refresh — on top of the main thread stalling on a
 * multi-megabyte JSON parse right as someone is trying to drop something
 * ("พอจะกดลากก็ค้าง...หรือเกิดจาก refresh อัตโนมัติ" — it was).
 *
 * Counter, not a boolean, so overlapping holders (two sheets open, a sidebar
 * in the mobile Sheet plus the desktop one) can't release each other's hold.
 * Saving is untouched — this only gates *incoming* polls.
 */
let holds = 0;

/** Takes a hold; call the returned function once to release it. */
export function holdServerSync(): () => void {
  holds += 1;
  let released = false;
  return () => {
    if (released) return; // double-release (StrictMode remount) must not go negative
    released = true;
    holds -= 1;
  };
}

export function isServerSyncHeld(): boolean {
  return holds > 0;
}
