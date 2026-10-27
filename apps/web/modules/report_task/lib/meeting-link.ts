/**
 * ลิงก์เปิดประชุมในปฏิทิน — ไปวันของประชุมแล้วเปิดรายละเอียดเลย (calendar-view.tsx อ่าน ?meeting=)
 * ใช้กับแจ้งเตือนเรื่องประชุมทุกแบบ (27/10/2569 "แท็กแล้วไม่มายังหน้าปฏิทินวันนั้น")
 */
export function meetingLink(meetingId: string): string {
  return `/report-task/calendar?meeting=${encodeURIComponent(meetingId)}`;
}
