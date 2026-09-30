import { NewDivider } from "@/components/new-divider";

/** Discord-style "new messages" line — a thin red rule marking where this
 * viewer's unread posts begin. Its position is frozen at the first-unread
 * post when the room is opened (see ReportFeed / OpenchatFeed), so it doesn't
 * creep as posts get marked read while you scroll. Same look as the chat's
 * (components/new-divider.tsx): red rule with a filled "NEW" tag on the right. */
export function NewMessagesDivider() {
  return <NewDivider className="px-5 py-1" />;
}
