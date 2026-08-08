import { create } from "zustand";
import { users, getUser } from "@/modules/report_task/data/mock";
import { canSeeReportTopic } from "@/modules/report_task/lib/permissions";
import { extractMentionedIds } from "@/modules/report_task/lib/report-feed-rich-text";
import { useNotificationStore } from "@/modules/report_task/store/notification-store";

export interface ReportPostSection {
  id: string;
  heading: string;
  bullets: string[];
}

export interface ReportPostImage {
  id: string;
  /** Uploaded image path from /api/report-task/uploads. */
  url?: string;
  /** Legacy inline data-URL image (pre-upload-endpoint / seed demo images) —
   * prefer `url ?? dataUrl` when rendering. */
  dataUrl?: string;
  name: string;
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
  hasSeeded: boolean;
  /** True once ServerStoreSync's initial GET has resolved — read `hasSeeded`
   * only after this to avoid seeding demo data before the real server value
   * has loaded (see report-feed/page.tsx). */
  loaded: boolean;
  addTopic: (data: { name: string; color?: string; icon?: string; logoUrl?: string; parentId?: string; description?: string; visibility?: ReportTopicVisibility }) => string;
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
  togglePin: (postId: string) => void;
  toggleSave: (postId: string, userId: string) => void;
  toggleUnread: (postId: string, userId: string) => void;
  /** Clears `unreadFor` on every post in a room for this viewer — opening a
   * room's posts marks it read, same as any chat app. A no-op update (no
   * post in this topic was unread for them) never touches `posts` at all,
   * so this is safe to call every time a room is opened, not just once. */
  markTopicRead: (topicId: string, userId: string) => void;
  toggleFavoriteTopic: (topicId: string, userId: string) => void;
  toggleHiddenTopic: (topicId: string, userId: string) => void;
  /** Creates a new named album for a room and returns its id. */
  addAlbum: (topicId: string, name: string, userId: string) => string;
  renameAlbum: (id: string, name: string) => void;
  /** Deleting an album never touches the images that pointed at it — they
   * just fall back to "not in any album" (see ReportPostImage.albumId) —
   * so nothing about the posts themselves needs to change here. */
  removeAlbum: (id: string) => void;
  seedDemoData: () => void;
}

const demoImageBlue: ReportPostImage = {
  id: "img-demo-blue",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAACMCAIAAAC283GzAAABf0lEQVR4nO3SQQkAIADAQKMaymzmsYRDkIMLsMfGXBuuG88L+JKxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi8QB3Ba5LqDrlcIAAAAASUVORK5CYII=",
  name: "screenshot-1.png",
};
const demoImageRed: ReportPostImage = {
  id: "img-demo-red",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAACMCAIAAAC283GzAAABfklEQVR4nO3SUQkAIBTAQHO+7IaxhEOQgwuwj609A9et5wV8yVgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxFwlgkjEXCWCSMRcJYJIxF4gAShO/3a8QvEQAAAABJRU5ErkJggg==",
  name: "screenshot-2.png",
};
const demoImageGreen: ReportPostImage = {
  id: "img-demo-green",
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAACMCAIAAAC283GzAAABf0lEQVR4nO3SQQkAIADAQHOaxIjGsoRDkIMLsMfG3AuuG88L+JKxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi4SxSBiLhLFIGIuEsUgYi8QBRzE2AuwIqtYAAAAASUVORK5CYII=",
  name: "screenshot-3.png",
};

function atTime(daysAgo: number, hours: number, minutes: number) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

// The renderer only puts a bullet dot on lines with an explicit "• " marker
// (typed via the composer's bulleted-list button) — this seed data predates
// that convention, so every line needs the marker baked in to render right.
function bulletList(items: string[]): string[] {
  return items.map((t) => `• ${t}`);
}

// Server-synced via ServerStoreSync (apiKey "report-feed") in
// store-hydrator.tsx — shared across teammates, not per-browser.
export const useReportFeedStore = create<ReportFeedStore>()(
  (set, get) => ({
      topics: defaultTopics,
      posts: [],
      albums: [],
      hasSeeded: false,
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
        set((s) => ({
          posts: [
            ...s.posts,
            {
              id: nextId("post"),
              topicId,
              authorId,
              createdAt: new Date().toISOString(),
              editedAt: null,
              pinned: false,
              savedBy: [],
              unreadFor: [],
              reactions: {},
              replies: [],
              ...data,
            },
          ],
        }));
        const topic = get().topics.find((t) => t.id === topicId);
        const actorName = getUser(authorId)?.name ?? "มีคน";
        // Anyone @mentioned in the post gets a distinct "tagged you" notice —
        // same phrasing as the meeting-attendee tag elsewhere — instead of
        // being lumped into the generic broadcast below with everyone else.
        const mentionedUserIds = extractMentionedIds(
          data.sections.flatMap((s) => s.bullets).join("\n"),
          "user"
        ).filter((id) => id !== authorId);
        if (mentionedUserIds.length > 0) {
          useNotificationStore.getState().notifyMany(mentionedUserIds, authorId, `${actorName} แท็กคุณในโพสต์ "${data.title}"`);
        }
        // Teams-style "new post in a channel" notification — everyone who
        // can see this topic, minus the poster and anyone already tagged
        // above (one notification per post, not two). No per-topic
        // subscription toggle exists yet, so this is an all-or-nothing default.
        if (topic) {
          const recipients = users
            .filter((u) => u.id !== authorId && !mentionedUserIds.includes(u.id) && canSeeReportTopic(topic.visibility, u.id))
            .map((u) => u.id);
          if (recipients.length > 0) {
            useNotificationStore.getState().notifyMany(recipients, authorId, `${actorName} โพสต์ใหม่ใน "${topic.name}": ${data.title}`);
          }
        }
      },
      editPost: (postId, data) =>
        set((s) => ({
          posts: s.posts.map((p) => (p.id === postId ? { ...p, ...data, editedAt: new Date().toISOString() } : p)),
        })),
      removePost: (id) => set((s) => ({ posts: s.posts.filter((p) => p.id !== id) })),
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
        useNotificationStore
          .getState()
          .notify({ userId: post.authorId, byUserId: userId, message: `${actorName} ทำเครื่องหมาย ${emoji} ให้โพสต์ของคุณ "${post.title}"` });
      },
      addReply: (postId, authorId, body, extra) => {
        set((s) => ({
          posts: s.posts.map((p) =>
            p.id === postId
              ? {
                  ...p,
                  replies: [
                    ...p.replies,
                    {
                      id: nextId("reply"),
                      authorId,
                      body,
                      createdAt: new Date().toISOString(),
                      images: extra?.images,
                      highlightColor: extra?.highlightColor,
                      replyToId: extra?.replyToId,
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
        const quotedAuthorId = extra?.replyToId ? post.replies.find((r) => r.id === extra.replyToId)?.authorId : undefined;
        if (quotedAuthorId && quotedAuthorId !== authorId) {
          useNotificationStore
            .getState()
            .notify({ userId: quotedAuthorId, byUserId: authorId, message: `${actorName} ตอบกลับความคิดเห็นของคุณใน "${post.title}"${preview ? `: ${preview}` : ""}` });
        }
        if (post.authorId !== authorId && post.authorId !== quotedAuthorId) {
          useNotificationStore
            .getState()
            .notify({ userId: post.authorId, byUserId: authorId, message: `${actorName} ตอบกลับโพสต์ของคุณ "${post.title}"${preview ? `: ${preview}` : ""}` });
        }
        // Anyone @mentioned in the reply, same "tagged you" phrasing as a
        // new post — skip whoever already got notified above as the
        // quoted-reply author or the post author, so a comment doesn't
        // double-notify someone who's both @mentioned and being replied to.
        const mentionedInReply = extractMentionedIds(body, "user").filter(
          (id) => id !== authorId && id !== quotedAuthorId && id !== post.authorId
        );
        if (mentionedInReply.length > 0) {
          useNotificationStore.getState().notifyMany(mentionedInReply, authorId, `${actorName} แท็กคุณในความคิดเห็นของโพสต์ "${post.title}"`);
        }
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
          const anyUnread = s.posts.some((p) => p.topicId === topicId && p.unreadFor.includes(userId));
          if (!anyUnread) return s;
          return {
            posts: s.posts.map((p) =>
              p.topicId === topicId && p.unreadFor.includes(userId)
                ? { ...p, unreadFor: p.unreadFor.filter((id) => id !== userId) }
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
      // Non-destructive: appends one report room per department (matching
      // the org chart in data/mock.ts) with a post from every single
      // profile, so every entry in the "viewing as" switcher has data tied
      // to it. Skips if already seeded once.
      seedDemoData: () =>
        set((s) => {
          if (s.topics.some((t) => t.id === "topic-demo-mk")) return { ...s, hasSeeded: true };

          // Each department gets a parent "team" topic (pure folder — no
          // cutoffs, can't be posted into directly) plus one child topic
          // that actually carries the daily cutoffs/minImages and is where
          // every seed post below lands — the same Teams-style split as
          // "ทั่วไป" / "ประกาศทั่วไป", applied consistently across every
          // room instead of leaving them flat. Child inherits the parent's
          // visibility so access stays identical top-to-bottom.
          const demoTopics: ReportTopic[] = [
            { id: "topic-demo-dev2", name: "ทีมพัฒนา (ตัวอย่าง)", color: "var(--chart-blue)", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [], visibility: { departmentIds: ["dep-eng"] } },
            { id: "topic-demo-dev2-daily", name: "เช็คอินประจำวัน", color: "var(--chart-blue)", parentId: "topic-demo-dev2", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [{ id: "cutoff-dev2-am", label: "เช้า", time: "09:00" }], visibility: { departmentIds: ["dep-eng"] } },
            { id: "topic-demo-design2", name: "ทีมดีไซน์ (ตัวอย่าง)", color: "var(--chart-violet)", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [], visibility: { departmentIds: ["dep-design"] } },
            { id: "topic-demo-design2-daily", name: "เช็คอินประจำวัน", color: "var(--chart-violet)", parentId: "topic-demo-design2", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [{ id: "cutoff-design2-am", label: "เช้า", time: "09:30" }], visibility: { departmentIds: ["dep-design"] } },
            { id: "topic-demo-mk", name: "การตลาด (ตัวอย่าง)", color: "var(--chart-orange)", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [], visibility: { departmentIds: ["dep-marketing"] } },
            { id: "topic-demo-mk-daily", name: "เช็คอินประจำวัน", color: "var(--chart-orange)", parentId: "topic-demo-mk", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [{ id: "cutoff-mk-am", label: "เช้า", time: "09:00" }], visibility: { departmentIds: ["dep-marketing"] } },
            { id: "topic-demo-sales", name: "ฝ่ายขาย (ตัวอย่าง)", color: "var(--chart-amber)", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [], visibility: { departmentIds: ["dep-sales"] } },
            { id: "topic-demo-sales-daily", name: "เช็คอินประจำวัน", color: "var(--chart-amber)", parentId: "topic-demo-sales", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [{ id: "cutoff-sales-am", label: "เช้า", time: "09:00" }], visibility: { departmentIds: ["dep-sales"] } },
            { id: "topic-demo-ops", name: "ปฏิบัติการ (ตัวอย่าง)", color: "var(--chart-green)", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [], visibility: { departmentIds: ["dep-ops"] } },
            { id: "topic-demo-ops-daily", name: "เช็คอินประจำวัน", color: "var(--chart-green)", parentId: "topic-demo-ops", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [{ id: "cutoff-ops-am", label: "เช้า", time: "09:00" }, { id: "cutoff-ops-pm", label: "บ่าย", time: "14:00" }], visibility: { departmentIds: ["dep-ops"] } },
            { id: "topic-demo-support", name: "บริการลูกค้า (ตัวอย่าง)", color: "var(--chart-pink)", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [], visibility: { departmentIds: ["dep-support"] } },
            { id: "topic-demo-support-daily", name: "เช็คอินประจำวัน", color: "var(--chart-pink)", parentId: "topic-demo-support", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [{ id: "cutoff-support-am", label: "เช้า", time: "10:00" }], visibility: { departmentIds: ["dep-support"] } },
            { id: "topic-demo-exec", name: "ภาพรวมผู้บริหาร (ตัวอย่าง)", color: "var(--chart-red)", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [], visibility: { managerOnly: true } },
            { id: "topic-demo-exec-summary", name: "สรุปภาพรวม", color: "var(--chart-red)", parentId: "topic-demo-exec", createdAt: atTime(2, 8, 0), minImages: 0, cutoffs: [], visibility: { managerOnly: true } },
            // Manager-only parent + one child, no cutoff — company policy
            // announcements aren't a daily check-in, but still follow the
            // "post only in the sub-topic" hierarchy like every other room.
            { id: "topic-demo-announce", name: "ประกาศบริษัท (ตัวอย่าง)", color: "var(--chart-blue)", createdAt: atTime(2, 10, 0), minImages: 0, cutoffs: [], visibility: { managerOnly: true } },
            { id: "topic-demo-announce-policies", name: "นโยบายและประกาศ", color: "var(--chart-blue)", parentId: "topic-demo-announce", createdAt: atTime(2, 10, 0), minImages: 0, cutoffs: [], visibility: { managerOnly: true } },
          ];

          const base = (overrides: Partial<ReportPost> & { id: string; topicId: string; authorId: string; title: string }): ReportPost => ({
            createdAt: atTime(0, 9, 0),
            editedAt: null,
            sections: [],
            images: [],
            pinned: false,
            savedBy: [],
            unreadFor: [],
            reactions: {},
            replies: [],
            ...overrides,
          });

          const demoPosts: ReportPost[] = [
            // ทีมพัฒนา (dep-eng): usr-01
            base({
              id: "post-demo-dev2-01", topicId: "topic-demo-dev2-daily", authorId: "usr-01", createdAt: atTime(0, 8, 10),
              title: "เช็คอินเช้า",
              sections: [{ id: "sec-dev2-01", heading: "", bullets: bulletList(["เริ่มงานตามคิว sprint วันนี้"]) }],
            }),
            // ทีมดีไซน์ (dep-design): usr-04
            base({
              id: "post-demo-design2-01", topicId: "topic-demo-design2-daily", authorId: "usr-04", createdAt: atTime(0, 9, 40),
              title: "เช็คอินเช้า",
              sections: [{ id: "sec-design2-01", heading: "", bullets: bulletList(["รีวิว wireframe หน้าใหม่"]) }],
            }),

            // การตลาด (dep-marketing): usr-06, usr-07
            base({
              id: "post-demo-mk-01", topicId: "topic-demo-mk-daily", authorId: "usr-06", createdAt: atTime(0, 8, 0),
              title: "สรุปแคมเปญ IG สัปดาห์นี้",
              sections: [{ id: "sec-mk-01", heading: "ผลลัพธ์", bullets: bulletList(["ยอด engagement +18%", "เตรียมคอนเทนต์รอบหน้า"]) }],
              images: [demoImageBlue], reactions: { "🎉": ["usr-01", "usr-02", "usr-03"] },
              replies: [{ id: "reply-demo-2", authorId: "usr-07", body: "เยี่ยมมากครับ พี่สุดา", createdAt: atTime(0, 8, 5) }],
            }),
            base({
              // Plain-text check-in — no image required, just a quick note.
              id: "post-demo-mk-02", topicId: "topic-demo-mk-daily", authorId: "usr-07", createdAt: atTime(0, 18, 5),
              title: "เช็คอินเย็น — สรุปก่อนเลิกงาน",
              sections: [{ id: "sec-mk-02", heading: "", bullets: bulletList(["ร่างสคริปต์วิดีโอโปรโมทเสร็จแล้ว พรุ่งนี้ส่งให้ทีมรีวิว"]) }],
            }),
            base({
              // Yesterday's on-time check-in — gives this room the same 2-of-3-
              // tracked-days coverage every other demo room has, instead of
              // every marketing post landing on the same day (see the Report
              // compliance dashboard, which would otherwise read this room as
              // "missed" every day but today).
              id: "post-demo-mk-03", topicId: "topic-demo-mk-daily", authorId: "usr-06", createdAt: atTime(1, 8, 30),
              title: "เช็คอินเช้า — วางแผนแคมเปญวันนี้",
              sections: [{ id: "sec-mk-03", heading: "", bullets: bulletList(["เตรียมคอนเทนต์ลง IG ช่วงบ่าย"]) }],
            }),

            // ฝ่ายขาย (dep-sales): usr-08, usr-09
            base({
              // Plain-text check-in.
              id: "post-demo-sales-01", topicId: "topic-demo-sales-daily", authorId: "usr-08", createdAt: atTime(0, 8, 55),
              title: "เช็คอินเช้า — เริ่มงานแล้ว",
              sections: [{ id: "sec-sales-01", heading: "", bullets: bulletList(["พร้อมโทรติดตามลูกค้าตามคิวที่วางไว้วันนี้"]) }],
            }),
            base({
              id: "post-demo-sales-02", topicId: "topic-demo-sales-daily", authorId: "usr-09", createdAt: atTime(0, 11, 0),
              title: "ติดตามลูกค้าใหม่",
              sections: [{ id: "sec-sales-02", heading: "งานวันนี้", bullets: bulletList(["โทรติดตามลีด 5 ราย", "นัดพรีเซนต์ลูกค้าใหญ่วันศุกร์"]) }],
              images: [demoImageBlue],
            }),
            base({
              // Yesterday's on-time check-in — same coverage reasoning as marketing above.
              id: "post-demo-sales-03", topicId: "topic-demo-sales-daily", authorId: "usr-08", createdAt: atTime(1, 8, 40),
              title: "เช็คอินเช้า — คิวโทรวันนี้",
              sections: [{ id: "sec-sales-03", heading: "", bullets: bulletList(["จัดคิวโทรลูกค้าเก่า 8 ราย"]) }],
            }),

            // ปฏิบัติการ (dep-ops): usr-10, usr-11
            base({
              // Plain-text check-in.
              id: "post-demo-ops-01", topicId: "topic-demo-ops-daily", authorId: "usr-10", createdAt: atTime(0, 8, 20),
              title: "เช็คอินเช้า — เริ่มตรวจสต็อก",
              sections: [{ id: "sec-ops-01", heading: "", bullets: bulletList(["เริ่มตรวจสต็อกคลังสินค้าตามรอบปกติ"]) }],
            }),
            base({
              id: "post-demo-ops-02", topicId: "topic-demo-ops-daily", authorId: "usr-11", createdAt: atTime(1, 13, 0),
              title: "วิเคราะห์ต้นทุนการขนส่ง",
              sections: [{ id: "sec-ops-02", heading: "ปัญหา", bullets: bulletList(["ข้อมูลจากซัพพลายเออร์ยังไม่ครบ", "รอคอนเฟิร์มราคาจากคู่ค้า"]) }],
              images: [demoImageBlue, demoImageRed], reactions: { "😮": ["usr-10"] },
            }),

            // บริการลูกค้า (dep-support): usr-12, usr-13
            base({
              id: "post-demo-support-01", topicId: "topic-demo-support-daily", authorId: "usr-12", createdAt: atTime(0, 9, 30),
              title: "สรุปเคสลูกค้าวันนี้",
              sections: [{ id: "sec-support-01", heading: "สรุป", bullets: bulletList(["ปิดเคส 12 เรื่อง", "คะแนนความพึงพอใจเฉลี่ย 4.6/5"]) }],
              images: [demoImageBlue],
            }),
            base({
              // Plain-text check-in.
              id: "post-demo-support-02", topicId: "topic-demo-support-daily", authorId: "usr-13", createdAt: atTime(0, 17, 50),
              title: "เช็คอินเย็น — สรุปก่อนเลิกงาน",
              sections: [{ id: "sec-support-02", heading: "", bullets: bulletList(["จัดการเคสค้างหมดแล้ว พรุ่งนี้เริ่มใหม่"]) }],
            }),
            base({
              // Yesterday's on-time check-in — same coverage reasoning as marketing/sales above.
              id: "post-demo-support-03", topicId: "topic-demo-support-daily", authorId: "usr-12", createdAt: atTime(1, 9, 20),
              title: "เช็คอินเช้า — เริ่มดูคิวเคสวันนี้",
              sections: [{ id: "sec-support-03", heading: "", bullets: bulletList(["ไล่คิวเคสค้างจากเมื่อวาน 5 เรื่อง"]) }],
            }),

            // ภาพรวมผู้บริหาร: usr-15 (CEO)
            base({
              id: "post-demo-exec-01", topicId: "topic-demo-exec-summary", authorId: "usr-15", createdAt: atTime(0, 7, 30),
              title: "สรุปภาพรวมบริษัทประจำสัปดาห์", pinned: true,
              sections: [{ id: "sec-exec-01", heading: "ไฮไลต์", bullets: bulletList(["ทุกแผนกส่งรีพอตครบตามรอบ", "ยอดขายไตรมาสนี้เป็นไปตามเป้า"]) }],
              images: [demoImageBlue, demoImageGreen, demoImageRed],
              reactions: { "👍": ["usr-01", "usr-06", "usr-08", "usr-10", "usr-12"] },
            }),

            // ประกาศบริษัท — flat, open topic (no cutoff, optional posting).
            base({
              id: "post-demo-announce-01", topicId: "topic-demo-announce-policies", authorId: "usr-15", createdAt: atTime(2, 8, 0), pinned: true,
              title: "เปิดตัวฟีเจอร์ใหม่: จัดกลุ่มหัวข้อรายงาน",
              sections: [{ id: "sec-announce-01", heading: "", bullets: bulletList(["ตอนนี้สามารถสร้างหัวข้อย่อยใต้หัวข้อหลักได้แล้ว เหมือน Teams", "หัวข้อหลักไว้จัดกลุ่ม ส่วนโพสต์รายงานให้โพสต์ในหัวข้อย่อย"]) }],
              reactions: { "🎉": ["usr-01", "usr-06", "usr-10"] },
            }),
          ];

          return {
            topics: [...s.topics, ...demoTopics],
            posts: [...s.posts, ...demoPosts],
            hasSeeded: true,
          };
        }),
  })
);
