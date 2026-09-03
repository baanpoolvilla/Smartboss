import { create } from "zustand";
import { users, getUser } from "@/modules/report_task/lib/directory";
import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { extractMentionedIds } from "@/modules/report_task/lib/report-feed-rich-text";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";

/** Rooms created at/after this pick their `feedViewMode` once in the
 * create-room dialog and can't change it afterward (see that field's own
 * comment); rooms from before stay fully editable in room-settings-sheet.tsx
 * — an explicit cutoff instead of a boolean flag so it needs no migration
 * of existing data, and reads directly off `createdAt`, which every topic
 * already has. */
export const FEED_VIEW_MODE_LOCK_CUTOFF = "2026-08-25T00:00:00.000Z";

export interface ReportPostSection {
  id: string;
  heading: string;
  bullets: string[];
}

export interface ReportPostImage {
  id: string;
  /** Uploaded image (or video, see `mime`) path from /api/uploads. */
  url?: string;
  /** Legacy inline data-URL image (pre-upload-endpoint / seed demo images) —
   * prefer `url ?? dataUrl` when rendering. */
  dataUrl?: string;
  name: string;
  /** Real MIME type from the server's magic-byte sniff (see /api/report-task/uploads).
   * Undefined = image (every attachment was one before video support existed,
   * so old rows have no reason to carry this) — `mime?.startsWith("video/")`
   * is the one check every render site needs to pick `<video>` over `<img>`. */
  mime?: string;
  /** Byte size from the upload response — undefined for anything attached
   * before this was threaded through (old posts). Only used when someone
   * saves the attachment into the room's actual document library ("เอกสาร
   * ของห้องนี้" / company-files) — that write needs a real size, unlike
   * rendering a thumbnail which doesn't care. */
  size?: number;
  /** Which named album (see ReportAlbum) this image is curated into, if any —
   * same LINE-style split as a regular chat photo vs. one explicitly saved
   * to a Keep album. The image always stays attached to its post/reply
   * either way; this only decides whether it's *also* organized into one of
   * the room's albums (report-topic-panels.tsx's "ไฟล์" tab). Undefined
   * means "not in any album" — just view it in the post, nothing curated. */
  albumId?: string;
}

/** A named photo collection scoped to one room — e.g. "ทริปดูงาน ส.ค." — so a
 * room's saved photos read as organized folders instead of one giant flat
 * roll. Membership lives on each image (`ReportPostImage.albumId`), not
 * here, so deleting an album never has to touch every post that referenced
 * it — those images just fall back to "not in any album". */
export interface ReportAlbum {
  id: string;
  topicId: string;
  name: string;
  createdAt: string;
  createdBy: string;
}

export interface ReportPostReply {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  /** Same idea as ReportPost.unreadFor, one level down — who hasn't seen this
   * particular reply yet. Drives the "ข้อความใหม่" divider in the replies
   * list (see ReportCard) the same way it drives the one in the post feed.
   * Absent on a reply from before this existed — treated as "everyone's
   * read it" rather than crashing every `.includes()` call site, same
   * normalization reasoning ReportPost's own array fields get. */
  unreadFor?: string[];
  /** Set once the reply's own text/images have been changed after posting —
   * same "· แก้ไขแล้ว" tag the post itself already carries (editedAt), just
   * one level down. Undefined/null = never edited. */
  editedAt?: string | null;
  /** emoji -> userIds who reacted with it, same shape as ReportPost.reactions
   * — Teams lets you react to an individual reply, not just the post itself. */
  reactions?: Record<string, string[]>;
  images?: ReportPostImage[];
  /** A quick "flag this reply" color tint (e.g. red = urgent) — not per-character text highlighting, just a whole-reply marker. */
  highlightColor?: string;
  /** The specific reply this one is answering, if any — replies stay a flat
   * list (not a real tree) with a quoted reference shown above the body,
   * same shape as Teams' "reply to a message" instead of deep nesting. */
  replyToId?: string;
}

export interface ReportPostFields {
  title: string;
  sections: ReportPostSection[];
  images: ReportPostImage[];
  /** Which curated ReportTag ids this post is filed under — see
   * report-tag-store.ts. A post can carry more than one (e.g. "ด่วน" +
   * "งานลูกค้า A"), unlike topicId which is single-select. Empty array, not
   * undefined, when untagged — every ReportPost has always had `[]`-shaped
   * array fields (images, replies, ...) rather than optional ones, so
   * `.some()`/`.length` callers never need an `?? []` guard. */
  tagIds: string[];
}

export interface ReportPost extends ReportPostFields {
  id: string;
  topicId: string;
  authorId: string;
  createdAt: string;
  editedAt: string | null;
  pinned: boolean;
  savedBy: string[];
  unreadFor: string[];
  /** emoji -> userIds who reacted with it */
  reactions: Record<string, string[]>;
  replies: ReportPostReply[];
  /** Set once someone opens this post as a Task (see report-card.tsx) — lets
   * the card show "เปิดงานที่เชื่อมไว้" instead of "สร้างเป็นงาน" the next time,
   * so a post never spawns two duplicate tasks by accident. */
  linkedTaskId?: string;
}

/** A daily submission window (e.g. "เช้า" due 09:00) a room can require reports by. */
export interface ReportCutoff {
  id: string;
  label: string;
  /** "HH:mm", 24h */
  time: string;
  /**
   * Overrides the room's blanket `minImages` for posts made during this
   * round specifically (e.g. เช้า needs 2 photos, เย็น is a text-only
   * check-in) — undefined means "follow the room default". 0 explicitly
   * means "no photo needed this round", distinct from "follow the default".
   */
  minImages?: number;
}

/**
 * Who can see/post in a room. Undefined (or both fields empty) = everyone —
 * matches how every topic behaved before this existed, so old/persisted
 * topics with no `visibility` stay open rather than silently locking out.
 */
export interface ReportTopicVisibility {
  /** Restrict to these departments (by id) — empty/undefined = no department gate. */
  departmentIds?: string[];
  /** Restrict to department heads + the owner, regardless of department. */
  managerOnly?: boolean;
  /** Restrict to these specific people (by user id) — combinable with nothing else; picking this mode clears department/managerOnly. */
  userIds?: string[];
  /** Extra individuals let in on top of `departmentIds` — e.g. a designer looped into an engineering-only room without opening it to all of design. Only meaningful alongside `departmentIds`. */
  extraUserIds?: string[];
  /** Members who can see/post in this room but aren't held to its posting schedule — e.g. someone just looped in to observe/advise. Excluded from `mustReportToTopic` (see permissions.ts), so compliance tracking (ตรงเวลา/สาย/ไม่ส่ง) never counts them. Always a subset of who the room's other visibility rules already let in. */
  exemptUserIds?: string[];
}

export interface ReportTopic {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  /** Minimum photos required per post by default (0 = not required) — a room can require 2-3, not just "any". */
  minImages: number;
  cutoffs: ReportCutoff[];
  visibility?: ReportTopicVisibility;
  /** Key into the icon picker's option list (see report-feed-sidebar.tsx) — unset falls back to a department-derived icon, then a plain hash. */
  icon?: string;
  /** A custom uploaded logo (data URL) — wins over `icon` when both are set. */
  logoUrl?: string;
  /** User ids who've starred this room — per-person, like `savedBy` on a post; a starred room pins to its own section at the top of the sidebar for that viewer only. */
  favoritedBy?: string[];
  /** Id of the top-level topic this one nests under, Teams-style (team > channel) — undefined means this is itself a top-level topic. Only one level deep: a topic that already has children can't also be a child. */
  parentId?: string;
  /** Deprecated, no longer read by anything (see `isCategory` below) — kept
   * only so a value saved on an older topic doesn't get silently dropped by
   * a save that touches other fields. Used to be a per-topic opt-out that
   * let a parent-with-children stay postable; removed after it caused real
   * confusion (a topic meant purely as a category still opened as a live,
   * postable room by default). */
  allowDirectPost?: boolean;
  /** Set once, at creation, for a topic made via "ห้องใหม่แยกอิสระ" — makes
   * it an organizing category forever, never clickable/postable itself, even
   * before it has any sub-topics yet (see topic-sidebar.tsx's canOpenDirectly).
   * A sub-topic never gets this (it can't have children of its own, so
   * there's nothing for it to organize). Topics created before this field
   * existed don't have it either — those stay usable standalone rooms as
   * they always were; this only governs topics created from here on. */
  isCategory?: boolean;
  /** User ids who've hidden this sub-topic from their own sidebar tree — Teams' "hide channel", per-viewer like `favoritedBy`. Still reachable through its parent's channel list (see report-topic-children-panel.tsx) to toggle back on; only affects the tree render, not visibility/access. */
  hiddenBy?: string[];
  /** Optional one-line blurb — "what this room is about", shown under its name in the header. Teams calls this a team/channel description; purely informational, no effect on permissions or behavior. */
  description?: string;

  // --- Phase 6 settings (all optional/backward-compatible — undefined means
  // "today's existing behavior", never a breaking default). ---

  /** Who can start a new post — undefined/"everyone" (today's behavior) or "managersOnly" for announcement/policy rooms. */
  postPermission?: "everyone" | "managersOnly";
  /** Read-only room — the reply box hides for everyone, existing replies stay visible. */
  commentsDisabled?: boolean;
  /** Which weekdays (0=Sun..6=Sat) count toward the posting schedule — undefined/empty = every day (today's behavior, incl. weekends). */
  requiredWeekdays?: number[];
  /** Starter sections (heading only, no bullets) the composer prefills for a brand-new post here — undefined = the composer starts blank (today's behavior). */
  postTemplateSections?: { heading: string }[];
  /** How many days a photo stays in the "ไฟล์" tab's rolling window — undefined = the app-wide default (FILES_TAB_WINDOW_DAYS). */
  filesRetentionDays?: number;
  /** How this room's posts are laid out — "stream" ("Openchat", chat-log,
   * default) or "threads" ("Thread", forum thread list) — a room-wide
   * setting, not a per-viewer preference: everyone in the room sees the
   * same layout. For a room created before FEED_VIEW_MODE_LOCK_CUTOFF this
   * is still editable anytime from room-settings-sheet.tsx (grandfathered —
   * see that file's own comment); for a room created at/after it, this was
   * chosen once in the create-room dialog (topic-sidebar.tsx) and the
   * settings sheet only displays it read-only. Undefined = "stream", same
   * as every room before this setting existed. */
  feedViewMode?: "stream" | "threads";
  /** Archived rooms drop out of the sidebar tree and topic pickers but keep
   * their data — recoverable (toggle off), unlike `removeTopic`. */
  archived?: boolean;
  /** Minutes before the day's last cutoff to remind whoever hasn't posted
   * yet — undefined/0 = off. Saved for whenever the reminder-delivery sweep
   * lands; not wired to send anything yet. */
  remindBeforeCutoffMinutes?: number;
  /** Notify the room's managers once a cutoff round closes, summarizing who
   * was late/missing — saved for whenever the delivery sweep lands; not
   * wired to send anything yet. */
  notifyManagerSummary?: boolean;
  /** Per-viewer "which posts in this room notify me" — undefined = "all" (today's behavior). Same per-viewer-map shape as `hiddenBy`/`favoritedBy`. Saved for whenever notification delivery reads it; doesn't suppress anything yet. */
  notifyPreference?: Record<string, "all" | "mentions" | "off">;
}

/**
 * Repairs a `report-feed` slice coming off the server before it reaches the
 * store.
 *
 * Every array field on ReportPost/ReportTopic is declared non-optional on
 * purpose (see ReportPostFields' own comment) so call sites can write
 * `post.tagIds.includes(...)` with no `?? []` guard — roughly forty of them
 * do. That contract holds for anything this store writes itself, but the
 * server row is just whatever JSON was last PUT to the `report-feed` key,
 * and a writer outside this file can leave a field out entirely: the demo
 * seeding script (scripts/seed-report-task-demo.ts) built its post rows
 * without `tagIds`, which took the whole รายงาน page down with "Cannot read
 * properties of undefined (reading 'includes')" thrown from ReportCard's tag
 * lookup — one bad row is enough, since it crashes during render and the
 * route's error boundary replaces the entire page.
 *
 * Normalizing on the way in fixes every such call site at once and, unlike
 * patching them one by one, also repairs rows already sitting in the
 * database. Field-by-field rather than a blanket cast — a missing array must
 * become `[]`, and an existing one must be left exactly as it is.
 */
export function normalizeReportFeedSlice(slice: {
  topics?: ReportTopic[];
  posts?: ReportPost[];
  albums?: ReportAlbum[];
}): { topics: ReportTopic[]; posts: ReportPost[]; albums: ReportAlbum[] } {
  return {
    topics: (slice.topics ?? []).map((t) => ({
      ...t,
      minImages: t.minImages ?? 0,
      cutoffs: t.cutoffs ?? [],
    })),
    posts: (slice.posts ?? []).map((p) => ({
      ...p,
      sections: p.sections ?? [],
      images: p.images ?? [],
      tagIds: p.tagIds ?? [],
      savedBy: p.savedBy ?? [],
      unreadFor: p.unreadFor ?? [],
      reactions: p.reactions ?? {},
      replies: (p.replies ?? []).map((r) => ({
        ...r,
        images: r.images ?? [],
        reactions: r.reactions ?? {},
      })),
    })),
    albums: slice.albums ?? [],
  };
}

/** True for a room whose one-time create-dialog pick actually landed on
 * "Openchat" (see FEED_VIEW_MODE_LOCK_CUTOFF) — a room from before that
 * cutoff defaulting to `feedViewMode: undefined` is just an ordinary
 * grandfathered "stream" room, not a deliberate Discord-style pick, so it
 * keeps the original ReportCard rendering instead of switching to
 * OpenchatFeed underneath it. */
export function isOpenchatTopic(topic: Pick<ReportTopic, "feedViewMode" | "createdAt">): boolean {
  return topic.feedViewMode !== "threads" && topic.createdAt >= FEED_VIEW_MODE_LOCK_CUTOFF;
}

export const topicColors = [
  "var(--chart-blue)",
  "var(--chart-violet)",
  "var(--chart-orange)",
  "var(--chart-amber)",
  "var(--chart-green)",
  "var(--chart-pink)",
  "var(--chart-red)",
];

const nextId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

/** Drops `userId` from every reply's `unreadFor` in one post's replies —
 * shared by markTopicRead/markPostsRead so opening a room/post clears the
 * in-thread "ข้อความใหม่" divider the same moment it clears the post-level
 * unread signal, not on some separate action nobody triggers. */
function clearReplyUnread(replies: ReportPostReply[], userId: string): ReportPostReply[] {
  return replies.map((r) => (r.unreadFor?.includes(userId) ? { ...r, unreadFor: r.unreadFor.filter((id) => id !== userId) } : r));
}

// "ทั่วไป" ships as a parent (Teams-style "team") with one sub-topic out of
// the box — a bare parent with no children would let someone post straight
// into it (isParentTopic only kicks in once a child exists), and it gives
// every fresh workspace a working example of the hierarchy instead of an
// empty flat list.
const defaultTopics: ReportTopic[] = [
  { id: "topic-general", name: "ทั่วไป", color: topicColors[0]!, createdAt: "2026-01-01T00:00:00.000Z", minImages: 0, cutoffs: [] },
  { id: "topic-general-announce", name: "ประกาศทั่วไป", color: topicColors[1]!, createdAt: "2026-01-01T00:00:00.000Z", minImages: 0, cutoffs: [], parentId: "topic-general" },
];

interface ReportFeedStore {
  topics: ReportTopic[];
  posts: ReportPost[];
  albums: ReportAlbum[];
  /** True once ServerStoreSync's initial GET has resolved. */
  loaded: boolean;
  addTopic: (data: {
    name: string;
    color?: string;
    icon?: string;
    logoUrl?: string;
    parentId?: string;
    description?: string;
    visibility?: ReportTopicVisibility;
    feedViewMode?: "stream" | "threads";
    isCategory?: boolean;
  }) => string;
  removeTopic: (id: string) => void;
  updateTopicSettings: (
    id: string,
    patch: {
      name?: string;
      color?: string;
      icon?: string;
      logoUrl?: string;
      minImages?: number;
      cutoffs?: ReportCutoff[];
      visibility?: ReportTopicVisibility;
      parentId?: string;
      description?: string;
      postPermission?: ReportTopic["postPermission"];
      commentsDisabled?: boolean;
      requiredWeekdays?: number[];
      postTemplateSections?: { heading: string }[];
      filesRetentionDays?: number;
      feedViewMode?: "stream" | "threads";
      archived?: boolean;
      remindBeforeCutoffMinutes?: number;
      notifyManagerSummary?: boolean;
    }
  ) => void;
  /** Per-viewer notification preference for one room — same "map keyed by
   * userId" pattern as toggleHiddenTopic/toggleFavoriteTopic. */
  setNotifyPreference: (topicId: string, userId: string, pref: "all" | "mentions" | "off") => void;
  addPost: (topicId: string, authorId: string, data: ReportPostFields) => void;
  editPost: (postId: string, data: ReportPostFields) => void;
  removePost: (id: string) => void;
  /** Records which Task a post was opened/converted into (see report-card.tsx's "เปิดเป็นงาน"). */
  setPostLinkedTask: (postId: string, taskId: string) => void;
  /** Moves an already-posted image in or out of an album after the fact
   * (the "ไฟล์" tab's one-tap save) — searches the post's own images and
   * every reply's images, since the caller only knows the image id, not
   * which of those it lives in. */
  setImageAlbum: (postId: string, imageId: string, albumId: string | undefined) => void;
  toggleReaction: (postId: string, emoji: string, userId: string) => void;
  addReply: (
    postId: string,
    authorId: string,
    body: string,
    extra?: { images?: ReportPostImage[]; highlightColor?: string; replyToId?: string }
  ) => void;
  /** Edits an existing reply's own text/images in place (own replies only —
   * gated in the UI, same as editPost) and stamps editedAt. */
  editReply: (postId: string, replyId: string, data: { body: string; images?: ReportPostImage[] }) => void;
  /** Removes a reply outright — its own replyToId quotes still resolve to
   * "ความคิดเห็นที่ถูกลบ" (see report-reply.tsx), same as a deleted quoted post. */
  deleteReply: (postId: string, replyId: string) => void;
  toggleReplyReaction: (postId: string, replyId: string, emoji: string, userId: string) => void;
  togglePin: (postId: string) => void;
  toggleSave: (postId: string, userId: string) => void;
  toggleUnread: (postId: string, userId: string) => void;
  /** Clears `unreadFor` on every post in a room for this viewer — opening a
   * room's posts marks it read, same as any chat app. A no-op update (no
   * post in this topic was unread for them) never touches `posts` at all,
   * so this is safe to call every time a room is opened, not just once. */
  markTopicRead: (topicId: string, userId: string) => void;
  /** Same idea as `markTopicRead`, scoped to an explicit list of post ids instead of a whole room. */
  markPostsRead: (postIds: string[], userId: string) => void;
  toggleFavoriteTopic: (topicId: string, userId: string) => void;
  toggleHiddenTopic: (topicId: string, userId: string) => void;
  /** Creates a new named album for a room and returns its id. */
  addAlbum: (topicId: string, name: string, userId: string) => string;
  renameAlbum: (id: string, name: string) => void;
  /** Deleting an album never touches the images that pointed at it — they
   * just fall back to "not in any album" (see ReportPostImage.albumId) —
   * so nothing about the posts themselves needs to change here. */
  removeAlbum: (id: string) => void;
}

// Server-synced via ServerStoreSync (apiKey "report-feed") in
// store-hydrator.tsx — shared across teammates, not per-browser.
export const useReportFeedStore = create<ReportFeedStore>()(
  (set, get) => ({
      topics: defaultTopics,
      posts: [],
      albums: [],
      loaded: false,
      addTopic: (data) => {
        const id = nextId("topic");
        set((s) => ({
          topics: [
            ...s.topics,
            {
              id,
              name: data.name,
              color: data.color ?? topicColors[s.topics.length % topicColors.length]!,
              icon: data.icon,
              logoUrl: data.logoUrl,
              parentId: data.parentId,
              description: data.description,
              visibility: data.visibility,
              feedViewMode: data.feedViewMode,
              isCategory: data.isCategory,
              createdAt: new Date().toISOString(),
              minImages: 0,
              cutoffs: [],
            },
          ],
        }));
        return id;
      },
      // Deleting a top-level (Teams-style) topic takes its sub-topics down
      // with it, same as deleting a Team removes its channels — a sub-topic
      // left pointing at a parentId that no longer exists would otherwise
      // dangle with no room settings/visibility of its own.
      removeTopic: (id) =>
        set((s) => {
          const removedIds = new Set([id, ...s.topics.filter((t) => t.parentId === id).map((t) => t.id)]);
          return {
            topics: s.topics.filter((t) => !removedIds.has(t.id)),
            posts: s.posts.filter((p) => !removedIds.has(p.topicId)),
          };
        }),
      updateTopicSettings: (id, patch) =>
        set((s) => ({
          topics: s.topics.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),
      addPost: (topicId, authorId, data) => {
        // Anyone @mentioned in the post gets a distinct "tagged you" notice —
        // same phrasing as the meeting-attendee tag elsewhere — instead of
        // being lumped into the generic broadcast below with everyone else.
        // Computed before the post is created so it can also seed the new
        // post's own `unreadFor` — an @mention should read as unread for the
        // mentioned person the same way a fresh post in their room does,
        // not require a separate manual "mark as unread" first (see
        // markPostsRead, cleared once they actually open ที่กล่าวถึงฉัน).
        const mentionedUserIds = extractMentionedIds(
          data.sections.flatMap((s) => s.bullets).join("\n"),
          "user"
        ).filter((id) => id !== authorId);
        // Captured up front (instead of generated inline inside the set()
        // call below) so a notification can deep-link straight to this exact
        // post — same ?topic=&post= shape ReportCard's own "copy link" uses.
        const postId = nextId("post");
        const link = `/report-feed?topic=${topicId}&post=${postId}`;
        const topic = get().topics.find((t) => t.id === topicId);
        // Everyone who can see this room, minus the poster themselves — same
        // set the "new post" notification below reaches. `unreadFor` is what
        // the sidebar's dot/bold/count actually reads (see topic-sidebar.tsx's
        // topicUnreadPosts); seeding it with only @mentions left a plain post
        // with no mention invisible to the rest of the room forever — nobody
        // but the author and anyone explicitly tagged ever saw it as unread,
        // no matter how long they'd had the room closed.
        const otherMemberIds = topic
          ? users.filter((u) => u.id !== authorId && canSeeReportTopic(topic.visibility, u.id)).map((u) => u.id)
          : [];
        set((s) => ({
          posts: [
            ...s.posts,
            {
              id: postId,
              topicId,
              authorId,
              createdAt: new Date().toISOString(),
              editedAt: null,
              pinned: false,
              savedBy: [],
              unreadFor: [...new Set([...mentionedUserIds, ...otherMemberIds])],
              reactions: {},
              replies: [],
              ...data,
            },
          ],
        }));
        const actorName = getUser(authorId)?.name ?? "มีคน";
        if (mentionedUserIds.length > 0) {
          useNotificationStore.getState().notifyMany(mentionedUserIds, authorId, `${actorName} แท็กคุณในโพสต์ "${data.title}"`, undefined, link);
        }
        // Teams-style "new post in a channel" notification — everyone who
        // can see this topic, minus the poster and anyone already tagged
        // above (one notification per post, not two). No per-topic
        // subscription toggle exists yet, so this is an all-or-nothing default.
        if (topic) {
          const recipients = otherMemberIds.filter((id) => !mentionedUserIds.includes(id));
          if (recipients.length > 0) {
            useNotificationStore.getState().notifyMany(recipients, authorId, `${actorName} โพสต์ใหม่ใน "${topic.name}": ${data.title}`, undefined, link);
          }
        }
      },
      editPost: (postId, data) =>
        set((s) => ({
          posts: s.posts.map((p) => (p.id === postId ? { ...p, ...data, editedAt: new Date().toISOString() } : p)),
        })),
      removePost: (id) => set((s) => ({ posts: s.posts.filter((p) => p.id !== id) })),
      setPostLinkedTask: (postId, taskId) =>
        set((s) => ({ posts: s.posts.map((p) => (p.id === postId ? { ...p, linkedTaskId: taskId } : p)) })),
      setImageAlbum: (postId, imageId, albumId) =>
        set((s) => ({
          posts: s.posts.map((p) => {
            if (p.id !== postId) return p;
            const setOn = (img: ReportPostImage) => (img.id === imageId ? { ...img, albumId } : img);
            return {
              ...p,
              images: p.images.map(setOn),
              replies: p.replies.map((r) => (r.images ? { ...r, images: r.images.map(setOn) } : r)),
            };
          }),
        })),
      toggleReaction: (postId, emoji, userId) => {
        let added = false;
        set((s) => ({
          posts: s.posts.map((p) => {
            if (p.id !== postId) return p;
            const current = p.reactions[emoji] ?? [];
            added = !current.includes(userId);
            const next = added ? [...current, userId] : current.filter((id) => id !== userId);
            return { ...p, reactions: { ...p.reactions, [emoji]: next } };
          }),
        }));
        // Reactions double as a quick "seen/acknowledged this" for the
        // person checking reports — worth notifying the post owner about,
        // same as a reply, but only on adding one (removing a reaction
        // isn't news) and never for reacting to your own post.
        if (!added) return;
        const post = get().posts.find((p) => p.id === postId);
        if (!post || post.authorId === userId) return;
        const actorName = getUser(userId)?.name ?? "มีคน";
        useNotificationStore.getState().notify({
          userId: post.authorId,
          byUserId: userId,
          message: `${actorName} ทำเครื่องหมาย ${emoji} ให้โพสต์ของคุณ "${post.title}"`,
          link: `/report-feed?topic=${post.topicId}&post=${postId}`,
        });
      },
      addReply: (postId, authorId, body, extra) => {
        // Captured up front so notifications below can deep-link straight to
        // this exact reply (?topic=&post=&reply=), same shape ReportCard's
        // own "copy link on a comment" already produces.
        const replyId = nextId("reply");
        const repliedPost = get().posts.find((p) => p.id === postId);
        const repliedTopic = repliedPost ? get().topics.find((t) => t.id === repliedPost.topicId) : undefined;
        // Same set addPost seeds a fresh post's unreadFor with — everyone who
        // can see this room, minus whoever's replying. Drives both the
        // in-thread "ข้อความใหม่" divider (this reply's own unreadFor) and
        // the post's own unread signal in the sidebar (a plain reply used to
        // flag neither — only an @mention inside one did, see the comment
        // that used to sit where mentionedInReply's block is below).
        const otherReplyMemberIds = repliedTopic
          ? users.filter((u) => u.id !== authorId && canSeeReportTopic(repliedTopic.visibility, u.id)).map((u) => u.id)
          : [];
        set((s) => ({
          posts: s.posts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  unreadFor: [...new Set([...p.unreadFor, ...otherReplyMemberIds])],
                  replies: [
                    ...p.replies,
                    {
                      id: replyId,
                      authorId,
                      body,
                      createdAt: new Date().toISOString(),
                      images: extra?.images,
                      highlightColor: extra?.highlightColor,
                      replyToId: extra?.replyToId,
                      unreadFor: otherReplyMemberIds,
                    },
                  ],
                }
              : p
          ),
        }));
        // Notify whoever's specifically being answered — the quoted reply's
        // author if this is a reply-to-a-comment, otherwise the post author
        // — never both if they're the same person, and never yourself.
        const post = get().posts.find((p) => p.id === postId);
        if (!post) return;
        const actorName = getUser(authorId)?.name ?? "มีคน";
        const preview = body.split("\n")[0]?.slice(0, 60) ?? "";
        const link = `/report-feed?topic=${post.topicId}&post=${postId}&reply=${replyId}`;
        const quotedAuthorId = extra?.replyToId ? post.replies.find((r) => r.id === extra.replyToId)?.authorId : undefined;
        if (quotedAuthorId && quotedAuthorId !== authorId) {
          useNotificationStore.getState().notify({
            userId: quotedAuthorId,
            byUserId: authorId,
            message: `${actorName} ตอบกลับความคิดเห็นของคุณใน "${post.title}"${preview ? `: ${preview}` : ""}`,
            link,
          });
        }
        if (post.authorId !== authorId && post.authorId !== quotedAuthorId) {
          useNotificationStore.getState().notify({
            userId: post.authorId,
            byUserId: authorId,
            message: `${actorName} ตอบกลับโพสต์ของคุณ "${post.title}"${preview ? `: ${preview}` : ""}`,
            link,
          });
        }
        // Anyone @mentioned in the reply, same "tagged you" phrasing as a
        // new post — skip whoever already got notified above as the
        // quoted-reply author or the post author, so a comment doesn't
        // double-notify someone who's both @mentioned and being replied to.
        const mentionedInReply = extractMentionedIds(body, "user").filter(
          (id) => id !== authorId && id !== quotedAuthorId && id !== post.authorId
        );
        if (mentionedInReply.length > 0) {
          // Already unread for them via otherReplyMemberIds above (anyone
          // @mentioned can see the room by definition) — just the "tagged
          // you" notification is specific to a mention.
          useNotificationStore.getState().notifyMany(mentionedInReply, authorId, `${actorName} แท็กคุณในความคิดเห็นของโพสต์ "${post.title}"`, undefined, link);
        }
      },
      editReply: (postId, replyId, data) =>
        set((s) => ({
          posts: s.posts.map((p) =>
            p.id !== postId
              ? p
              : {
                  ...p,
                  replies: p.replies.map((r) =>
                    r.id === replyId ? { ...r, body: data.body, images: data.images, editedAt: new Date().toISOString() } : r
                  ),
                }
          ),
        })),
      deleteReply: (postId, replyId) =>
        set((s) => ({
          posts: s.posts.map((p) =>
            p.id !== postId ? p : { ...p, replies: p.replies.filter((r) => r.id !== replyId) }
          ),
        })),
      toggleReplyReaction: (postId, replyId, emoji, userId) => {
        let added = false;
        set((s) => ({
          posts: s.posts.map((p) => {
            if (p.id !== postId) return p;
            return {
              ...p,
              replies: p.replies.map((r) => {
                if (r.id !== replyId) return r;
                const current = r.reactions?.[emoji] ?? [];
                added = !current.includes(userId);
                const next = added ? [...current, userId] : current.filter((id) => id !== userId);
                return { ...r, reactions: { ...r.reactions, [emoji]: next } };
              }),
            };
          }),
        }));
        // Same "notify on add only, never for reacting to your own" rule as
        // toggleReaction on the post itself.
        if (!added) return;
        const post = get().posts.find((p) => p.id === postId);
        const reply = post?.replies.find((r) => r.id === replyId);
        if (!post || !reply || reply.authorId === userId) return;
        const actorName = getUser(userId)?.name ?? "มีคน";
        useNotificationStore.getState().notify({
          userId: reply.authorId,
          byUserId: userId,
          message: `${actorName} ทำเครื่องหมาย ${emoji} ให้ความคิดเห็นของคุณใน "${post.title}"`,
          link: `/report-feed?topic=${post.topicId}&post=${postId}&reply=${replyId}`,
        });
      },
      togglePin: (postId) =>
        set((s) => ({
          posts: s.posts.map((p) => (p.id === postId ? { ...p, pinned: !p.pinned } : p)),
        })),
      toggleSave: (postId, userId) =>
        set((s) => ({
          posts: s.posts.map((p) => {
            if (p.id !== postId) return p;
            const saved = p.savedBy.includes(userId) ? p.savedBy.filter((id) => id !== userId) : [...p.savedBy, userId];
            return { ...p, savedBy: saved };
          }),
        })),
      toggleUnread: (postId, userId) =>
        set((s) => ({
          posts: s.posts.map((p) => {
            if (p.id !== postId) return p;
            const unread = p.unreadFor.includes(userId) ? p.unreadFor.filter((id) => id !== userId) : [...p.unreadFor, userId];
            return { ...p, unreadFor: unread };
          }),
        })),
      markTopicRead: (topicId, userId) =>
        set((s) => {
          const anyUnread = s.posts.some(
            (p) => p.topicId === topicId && (p.unreadFor.includes(userId) || p.replies.some((r) => r.unreadFor?.includes(userId)))
          );
          if (!anyUnread) return s;
          return {
            posts: s.posts.map((p) =>
              p.topicId === topicId
                ? { ...p, unreadFor: p.unreadFor.filter((id) => id !== userId), replies: clearReplyUnread(p.replies, userId) }
                : p
            ),
          };
        }),
      /** Clears `unreadFor` on a specific set of posts (and their replies)
       * for this viewer — used by ที่กล่าวถึงฉัน (topic-sidebar.tsx's
       * MENTIONS_ID), which spans posts across many rooms so
       * `markTopicRead`'s whole-room sweep isn't the right granularity there. */
      markPostsRead: (postIds, userId) =>
        set((s) => {
          const ids = new Set(postIds);
          const anyUnread = s.posts.some(
            (p) => ids.has(p.id) && (p.unreadFor.includes(userId) || p.replies.some((r) => r.unreadFor?.includes(userId)))
          );
          if (!anyUnread) return s;
          return {
            posts: s.posts.map((p) =>
              ids.has(p.id)
                ? { ...p, unreadFor: p.unreadFor.filter((id) => id !== userId), replies: clearReplyUnread(p.replies, userId) }
                : p
            ),
          };
        }),
      toggleFavoriteTopic: (topicId, userId) =>
        set((s) => ({
          topics: s.topics.map((t) => {
            if (t.id !== topicId) return t;
            const favoritedBy = t.favoritedBy ?? [];
            const next = favoritedBy.includes(userId) ? favoritedBy.filter((id) => id !== userId) : [...favoritedBy, userId];
            return { ...t, favoritedBy: next };
          }),
        })),
      toggleHiddenTopic: (topicId, userId) =>
        set((s) => ({
          topics: s.topics.map((t) => {
            if (t.id !== topicId) return t;
            const hiddenBy = t.hiddenBy ?? [];
            const next = hiddenBy.includes(userId) ? hiddenBy.filter((id) => id !== userId) : [...hiddenBy, userId];
            return { ...t, hiddenBy: next };
          }),
        })),
      setNotifyPreference: (topicId, userId, pref) =>
        set((s) => ({
          topics: s.topics.map((t) =>
            t.id === topicId ? { ...t, notifyPreference: { ...t.notifyPreference, [userId]: pref } } : t
          ),
        })),
      addAlbum: (topicId, name, userId) => {
        const id = nextId("album");
        set((s) => ({
          albums: [...s.albums, { id, topicId, name, createdAt: new Date().toISOString(), createdBy: userId }],
        }));
        return id;
      },
      renameAlbum: (id, name) =>
        set((s) => ({
          albums: s.albums.map((a) => (a.id === id ? { ...a, name } : a)),
        })),
      removeAlbum: (id) =>
        set((s) => ({
          albums: s.albums.filter((a) => a.id !== id),
        })),
  })
);
