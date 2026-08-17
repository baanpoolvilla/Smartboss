/** เวลาแบบสั้น ๆ ใต้แต่ละข้อความ — "10:32" วันนี้, "เมื่อวาน 10:32", หรือวันที่เต็ม */
export function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

  const isSameDay = d.toDateString() === now.toDateString();
  if (isSameDay) return time;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `เมื่อวาน ${time}`;

  return `${d.toLocaleDateString("th-TH", { day: "numeric", month: "short" })} ${time}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
