import type { ReactNode } from "react";
import { getDialogAvatar } from "@/lib/dialog-list";

type DialogListCardProps = {
  active?: boolean;
  emphasized?: boolean;
  onClick?: () => void;
  title: string;
  identityKey: string;
  avatarColor?: string | null;
  avatarEmoji?: string | null;
  statusDotClassName?: string;
  preview: string;
  managerLabel: string;
  timeLabel?: string;
  statusLabel?: string;
  statusBadgeClassName?: string;
  unreadCount?: number;
  pinned?: boolean;
  footerAction?: ReactNode;
};

export function DialogListCard({
  active = false,
  emphasized = false,
  onClick,
  title,
  identityKey,
  avatarColor,
  avatarEmoji,
  statusDotClassName,
  preview,
  managerLabel,
  timeLabel,
  statusLabel,
  statusBadgeClassName,
  unreadCount = 0,
  pinned = false,
  footerAction,
}: DialogListCardProps) {
  const avatar = getDialogAvatar(identityKey, avatarColor, avatarEmoji);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      }}
      className={`w-full rounded-[24px] border px-3.5 py-3 text-left transition ${
        active
          ? "border-[#CFE1FF] bg-[#F3F8FF] shadow-[0_12px_32px_rgba(10,132,255,0.09)]"
          : emphasized
            ? "border-[#D6E7FF] bg-[#EEF6FF]"
            : "border-[#E6E6EB] bg-white hover:bg-[#FAFAFC]"
      }`}
      >
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full text-[20px]"
            style={{ backgroundColor: avatar.color }}
            aria-hidden="true"
          >
            <span className="translate-y-[1px]">{avatar.emoji}</span>
          </div>
          {statusDotClassName ? (
            <span
              className={`absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${statusDotClassName}`}
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[16px] font-semibold text-[#1E1E1E]">{title}</p>
            {pinned ? (
              <span className="shrink-0 text-xs text-[#8E8E93]" title="Закреплён">
                📌
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[13px] leading-5 text-[#5F6572]">{preview}</p>
            {statusLabel ? (
              <span
                className={`shrink-0 inline-flex min-h-7 items-center justify-center rounded-full px-3 py-1 text-center text-[11px] font-medium leading-4 ${statusBadgeClassName ?? ""}`}
              >
                {statusLabel}
              </span>
            ) : null}
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-[12px] text-[#979DA8]">{managerLabel}</p>
            {timeLabel ? (
              <p className="shrink-0 text-[11px] text-[#A0A6B2]">{timeLabel}</p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {unreadCount > 0 ? (
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[#0A84FF] px-2 text-xs font-semibold text-white">
              {unreadCount}
            </span>
          ) : null}
        </div>
      </div>

      {footerAction ? <div className="mt-3 flex items-center gap-2">{footerAction}</div> : null}
    </div>
  );
}
