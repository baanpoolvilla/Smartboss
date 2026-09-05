/**
 * True on a touch/coarse-pointer device (phones, most tablets) — used to
 * turn off "Enter sends, Shift+Enter for a new line" chat-style shortcuts
 * there. That convention assumes a physical keyboard with an easy Shift
 * combo; on a phone's on-screen keyboard the return key just fires a plain
 * Enter with no way to add Shift, so every attempt to start a new line sent
 * the message/reply instead ("กด enter ในมือถือ...มันกลับไปกดส่งโพสเลย").
 * Desktop keeps the shortcut; touch devices fall back to Enter-always-
 * newlines + an explicit tap on the send/save button.
 */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}
