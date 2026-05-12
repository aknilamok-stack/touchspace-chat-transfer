"use client";

import { getDialogAvatar } from "@/lib/dialog-list";

type DialogListWideRowProps = {
  title: string;
  identityKey: string;
  avatarColor?: string | null;
  avatarEmoji?: string | null;
  statusDotClassName: string;
  managerLabel: string;
  lastMessageTimeLabel: string;
  firstResponseLabel: string;
  durationLabel: string;
  statusLabel: string;
  statusBadgeClassName: string;
  channelLabel: string;
  channelHref?: string;
  topicLabel: string;
  onClick: () => void;
};

export function DialogListWideRow({
  title,
  identityKey,
  avatarColor,
  avatarEmoji,
  statusDotClassName,
  managerLabel,
  lastMessageTimeLabel,
  firstResponseLabel,
  durationLabel,
  statusLabel,
  statusBadgeClassName,
  channelLabel,
  channelHref,
  topicLabel,
  onClick,
}: DialogListWideRowProps) {
  const avatar = getDialogAvatar(identityKey, avatarColor, avatarEmoji);

  return (
    <button
      type="button"
      onClick={onClick}
      className="grid w-full grid-cols-[minmax(260px,1.7fr)_140px_150px_110px_170px_minmax(200px,1.6fr)] items-start gap-4 rounded-[16px] border border-transparent px-4 py-3 text-left transition hover:border-[#D9E6FF] hover:bg-[#F8FBFF]"
    >
      <div className="flex min-w-0 items-start gap-3.5">
        <div className="relative mt-0.5 h-11 w-11 shrink-0 overflow-hidden rounded-full">
          <span
            className="flex h-full w-full items-center justify-center text-[20px]"
            style={{ backgroundColor: avatar.color }}
            aria-hidden="true"
          >
            {avatar.emoji}
          </span>
          <span
            className={`absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${statusDotClassName}`}
            aria-hidden="true"
          />
        </div>

        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold leading-[1.2] text-[#1E1E1E]">{title}</p>
          <div className="mt-1 flex items-center justify-between gap-3 text-[13px] text-[#8E8E93]">
            <p className="truncate">{managerLabel}</p>
            <span className="shrink-0">{lastMessageTimeLabel || "—"}</span>
          </div>
        </div>
      </div>

      <div>
        <p className="text-[14px] font-medium text-[#1E1E1E]">{firstResponseLabel}</p>
      </div>

      <div>
        <p className="text-[14px] font-medium text-[#1E1E1E]">{durationLabel}</p>
      </div>

      <div>
        <span
          className={`inline-flex min-h-[32px] items-center justify-center rounded-full px-3 py-1 text-center text-[12px] font-semibold leading-[1.2] ${statusBadgeClassName}`}
        >
          {statusLabel}
        </span>
      </div>

      <div>
        {channelHref && channelLabel !== "—" ? (
          <a
            href={channelHref}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="block truncate text-[13px] text-[#0A84FF] underline decoration-[#B9D6FF] underline-offset-2 transition hover:text-[#0077F2]"
            title={channelLabel}
          >
            {channelLabel}
          </a>
        ) : (
          <p className="truncate text-[13px] text-[#1E1E1E]" title={channelLabel}>
            {channelLabel}
          </p>
        )}
      </div>

      <div>
        <p className="line-clamp-2 text-[13px] leading-[1.35] text-[#1E1E1E]" title={topicLabel}>
          {topicLabel}
        </p>
      </div>
    </button>
  );
}
