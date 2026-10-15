"use client";

import { useState } from "react";
import { UserCircle2, Pencil, X, History } from "lucide-react";
import { Button } from "@smartboss/ui/components/button";
import { PhotoStrip } from "./photos";
import { CommentDeleteButton } from "./comment-delete-button";
import { CommentTextarea } from "./comment-textarea";

type Action = (formData: FormData) => void | Promise<void>;

/**
 * คอมเมนต์ 1 ชิ้นในใบงาน — อ่าน / แก้ไข / ลบ
 *
 * แก้ได้เฉพาะเจ้าของ (ดู updateWorkOrderComment) ส่วนลบ คนจัดการใบงานลบของ
 * ใครก็ได้ · ปุ่มทั้งสองจางไว้จนกว่าจะเอาเมาส์ไปวางหรือแตะ เพราะมันอยู่ทุกแถว
 * แต่นาน ๆ ใช้ที (เหตุผลเดียวกับ CommentDeleteButton ของ PO)
 */
export function WorkOrderComment({
  commentId,
  authorName,
  timeLabel,
  content,
  imageUrls,
  kind,
  canSeeRemoved = false,
  canEdit,
  canDelete,
  editAction,
  deleteAction,
}: {
  commentId: string;
  authorName: string;
  timeLabel: string;
  content: string;
  /** รูปทั้งหมดของความคิดเห็น (commentImages) · แถว log = รูปที่ถูกลบ */
  imageUrls: string[];
  /** "log" = บันทึกของระบบ (ลบรูป/ลบความคิดเห็น/เปลี่ยนบ้าน) — แสดงเป็นบรรทัดเทา ไม่มีปุ่มแก้/ลบ */
  kind?: string | null;
  /** เห็นรูปที่ถูกลบในบันทึก (คนจัดการใบงาน) */
  canSeeRemoved?: boolean;
  canEdit: boolean;
  canDelete: boolean;
  editAction: Action;
  deleteAction: Action;
}) {
  const [editing, setEditing] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  // "📷" = คอมเมนต์ที่มีแต่รูป (ไม่มีข้อความ) — ไม่ต้องแสดงเป็นข้อความ
  const isPhotoOnly = content === "📷";

  if (kind === "log") {
    return (
      <div className="flex flex-col gap-1 text-xs text-(--ink-soft)">
        <div className="flex flex-wrap items-center gap-1.5">
          <History className="h-3.5 w-3.5" />
          <b className="font-semibold">{authorName}</b>
          <span className="min-w-0 break-words">{content}</span>
          <span>· {timeLabel}</span>
          {canSeeRemoved && imageUrls.length > 0 && (
            <button type="button" onClick={() => setShowRemoved((v) => !v)} className="text-[#0F766E] underline-offset-2 hover:underline">
              {showRemoved ? "ซ่อนรูปที่ลบ" : `ดูรูปที่ลบ (${imageUrls.length})`}
            </button>
          )}
        </div>
        {showRemoved && (
          <div className="pl-5 opacity-80">
            <PhotoStrip urls={imageUrls} size={96} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group">
      <div className="flex items-center gap-1.5">
        <UserCircle2 className="h-4 w-4 text-(--ink-soft)" />
        <span className="text-[13px] font-bold text-(--ink)">{authorName}</span>
        <span className="text-[11px] text-(--ink-soft)">{timeLabel}</span>
        <span className="ml-auto flex items-center">
          {canEdit && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="แก้ไขความเห็นนี้"
              className="shrink-0 rounded p-1 text-(--ink-soft) opacity-50 hover:bg-(--bg-soft) hover:text-(--ink) hover:opacity-100"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {canDelete && !editing && (
            <CommentDeleteButton
              commentId={commentId}
              action={deleteAction}
              hasImages={imageUrls.length > 0}
              logged
            />
          )}
          {editing && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              aria-label="ยกเลิกการแก้ไข"
              className="shrink-0 rounded p-1 text-(--ink-soft) hover:bg-(--bg-soft) hover:text-(--ink)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>

      <div className="mt-1 pl-[22px]">
        {editing ? (
          <form
            action={(formData) => {
              setEditing(false);
              return editAction(formData);
            }}
            className="flex flex-col gap-2"
          >
            <input type="hidden" name="commentId" value={commentId} />
            <CommentTextarea
              defaultValue={isPhotoOnly ? "" : content}
              autoFocus
              ariaLabel="แก้ไขความเห็น"
            />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm">
                บันทึก
              </Button>
              <span className="text-xs text-(--ink-soft)">
                Shift+Enter ขึ้นบรรทัดใหม่
              </span>
            </div>
          </form>
        ) : (
          !isPhotoOnly && (
            <p className="whitespace-pre-wrap text-sm text-(--ink)">{content}</p>
          )
        )}
        {imageUrls.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {imageUrls.map((url, i) => (
              <div key={`${url}-${i}`} className="relative">
                <PhotoStrip urls={[url]} size={imageUrls.length > 1 ? 120 : 160} />
                {/* ลบทีละรูป — ถามยืนยันก่อน มีบันทึกว่าใครลบ (deleteCommentAction + imageUrl) */}
                {canDelete && !editing && (
                  <span className="absolute right-1 top-1 rounded-full bg-white/90 shadow-sm">
                    <CommentDeleteButton commentId={commentId} action={deleteAction} hasImages imageUrl={url} logged />
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
