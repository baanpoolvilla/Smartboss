"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useChatStore } from "../store/chat-store";
import { useChatPolling } from "../lib/use-chat-polling";
import {
  createGroupChannel,
  deleteMessage,
  fetchChannels,
  fetchMessages,
  fetchOrgUsers,
  markChannelRead,
  sendMessage,
  startDm,
} from "../lib/api";
import type { ChatAttachment, ChatUser } from "../types";
import { ChannelList } from "./channel-list";
import { MessageThread } from "./message-thread";
import { Composer } from "./composer";
import { NewChatDialog } from "./new-chat-dialog";

export function ChatApp({ currentUser }: { currentUser: ChatUser }) {
  useChatPolling();

  const channels = useChatStore((s) => s.channels);
  const activeChannelId = useChatStore((s) => s.activeChannelId);
  const messagesByChannel = useChatStore((s) => s.messagesByChannel);
  const setActiveChannel = useChatStore((s) => s.setActiveChannel);
  const setChannels = useChatStore((s) => s.setChannels);
  const setMessages = useChatStore((s) => s.setMessages);
  const appendMessages = useChatStore((s) => s.appendMessages);
  const replaceMessage = useChatStore((s) => s.replaceMessage);
  const removeMessage = useChatStore((s) => s.removeMessage);
  const markLocalRead = useChatStore((s) => s.markLocalRead);

  const [users, setUsers] = useState<ChatUser[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    fetchOrgUsers()
      .then((r) => setUsers(r.users))
      .catch(() => {
        // รายชื่อโหลดไม่ได้ก็ยังคุยในห้องที่มีอยู่ได้ปกติ แค่เริ่ม DM ใหม่ไม่ได้
      });
  }, []);

  const usersById = useMemo(() => {
    const map = new Map<string, ChatUser>();
    map.set(currentUser.id, currentUser);
    for (const u of users) map.set(u.id, u);
    return map;
  }, [users, currentUser]);

  const selectChannel = useCallback(
    async (id: string) => {
      setActiveChannel(id);
      markLocalRead(id);
      markChannelRead(id).catch(() => {});
      if (!useChatStore.getState().messagesByChannel[id]) {
        try {
          const { messages } = await fetchMessages(id);
          setMessages(id, messages);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "โหลดข้อความไม่สำเร็จ");
        }
      }
    },
    [setActiveChannel, setMessages, markLocalRead]
  );

  // เลือกห้องแรกอัตโนมัติตอนรายชื่อห้องโหลดมาครั้งแรก (ปกติคือห้องรวมทั้งบริษัท)
  useEffect(() => {
    if (!activeChannelId && channels.length > 0) selectChannel(channels[0]!.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.length]);

  async function handleSend(input: { body?: string; attachments?: ChatAttachment[] }) {
    if (!activeChannelId) return;
    const tempId = `temp-${Date.now()}`;
    appendMessages(activeChannelId, [
      {
        id: tempId,
        // seq จริงมาจากเซิร์ฟเวอร์เท่านั้น — ค่านี้ไม่ถูกใช้จัดเรียง (ดู
        // seqValue ใน chat-store.ts ที่เช็ค id ขึ้นต้นด้วย "temp-" ก่อนเสมอ)
        seq: "",
        channelId: activeChannelId,
        authorId: currentUser.id,
        body: input.body ?? null,
        attachments: input.attachments ?? [],
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const { message } = await sendMessage(activeChannelId, input);
      replaceMessage(activeChannelId, tempId, message);
    } catch (err) {
      removeMessage(activeChannelId, tempId);
      toast.error(err instanceof Error ? err.message : "ส่งข้อความไม่สำเร็จ");
    }
  }

  async function handleDelete(messageId: string) {
    if (!activeChannelId) return;
    // รอเซิร์ฟเวอร์ยืนยันก่อนค่อยเอาออกจากจอ (ต่างจากส่งข้อความที่ทำ optimistic
    // ได้เลย) — ลบเป็นการกระทำที่ย้อนกลับไม่ได้ ถ้า optimistic แล้วเซิร์ฟเวอร์
    // ปฏิเสธ (เช่นโดนลบไปแล้วจากอีกแท็บ) จะต้องมีโค้ดเอาข้อความกลับเข้าตำแหน่ง
    // เดิม ซึ่งซับซ้อนเกินความคุ้มสำหรับปุ่ม "ลบ" ที่กดไม่บ่อย
    try {
      await deleteMessage(activeChannelId, messageId);
      removeMessage(activeChannelId, messageId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ลบข้อความไม่สำเร็จ");
    }
  }

  async function openChannelAfterCreate(channelId: string) {
    setDialogOpen(false);
    try {
      const { channels: fresh } = await fetchChannels();
      setChannels(fresh);
    } catch {
      // ไม่เป็นไร — โพลรอบหน้าจะได้เอง
    }
    selectChannel(channelId);
  }

  async function handleStartDm(userId: string) {
    try {
      const { channelId } = await startDm(userId);
      await openChannelAfterCreate(channelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เริ่มแชทไม่สำเร็จ");
    }
  }

  async function handleCreateGroup(name: string, memberIds: string[]) {
    try {
      const { channelId } = await createGroupChannel(name, memberIds);
      await openChannelAfterCreate(channelId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "สร้างกลุ่มไม่สำเร็จ");
    }
  }

  const activeMessages = activeChannelId ? (messagesByChannel[activeChannelId] ?? []) : [];

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-[var(--line)]">
      <ChannelList
        channels={channels}
        usersById={usersById}
        currentUserId={currentUser.id}
        activeChannelId={activeChannelId}
        onSelect={selectChannel}
        onStartNew={() => setDialogOpen(true)}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-[var(--bg-soft)]">
        {activeChannelId ? (
          <>
            <MessageThread
              messages={activeMessages}
              currentUserId={currentUser.id}
              usersById={usersById}
              onDelete={handleDelete}
            />
            <Composer onSend={handleSend} />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-[var(--ink-soft)]">เลือกห้องแชททางซ้าย หรือเริ่มแชทใหม่</p>
          </div>
        )}
      </div>

      {dialogOpen && (
        <NewChatDialog
          users={users}
          onClose={() => setDialogOpen(false)}
          onStartDm={handleStartDm}
          onCreateGroup={handleCreateGroup}
        />
      )}
    </div>
  );
}
