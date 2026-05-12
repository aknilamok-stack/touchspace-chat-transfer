"use client";

import type { CSSProperties } from "react";

type IncomingAlertItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  preview: string;
  tone?: "blue" | "green" | "amber";
  avatarEmoji?: string | null;
  avatarColor?: string | null;
  primaryLabel?: string;
  secondaryLabel?: string;
  metaLabel?: string | null;
};

const notificationTone = {
  blue: {
    backgroundColor: "#0A84FF",
    borderColor: "#0A84FF",
    color: "#FFFFFF",
    boxShadow: "none",
    footerBackgroundColor: "#0A84FF",
    footerBorderColor: "rgba(255, 255, 255, 0.2)",
  },
  green: {
    backgroundColor: "#0A84FF",
    borderColor: "#0A84FF",
    color: "#FFFFFF",
    boxShadow: "none",
    footerBackgroundColor: "#0A84FF",
    footerBorderColor: "rgba(255, 255, 255, 0.2)",
  },
  amber: {
    backgroundColor: "#0A84FF",
    borderColor: "#0A84FF",
    color: "#FFFFFF",
    boxShadow: "none",
    footerBackgroundColor: "#0A84FF",
    footerBorderColor: "rgba(255, 255, 255, 0.2)",
  },
} as const;

function getInitialAvatar(title: string) {
  return title.trim().charAt(0).toUpperCase() || "?";
}

export function IncomingAlertStack({
  items,
  onClose,
  onSecondary,
  onPrimary,
}: {
  items: IncomingAlertItem[];
  onClose: (id: string) => void;
  onSecondary?: (id: string) => void;
  onPrimary?: (id: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  const stopNotificationAction = (event: {
    preventDefault: () => void;
    stopPropagation: () => void;
  }) => {
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[90] flex w-[min(420px,calc(100vw-24px))] flex-col gap-3">
      {items.map((item) => {
        const tone = notificationTone[item.tone ?? "blue"];
        const cardStyle = {
          "--touchspace-alert-bg": tone.backgroundColor,
          "--touchspace-alert-border": tone.borderColor,
          "--touchspace-alert-fg": tone.color,
          "--touchspace-alert-shadow": tone.boxShadow,
          "--touchspace-alert-footer-bg": tone.footerBackgroundColor,
          "--touchspace-alert-footer-border": tone.footerBorderColor,
          backgroundColor: tone.backgroundColor,
          borderColor: tone.borderColor,
          color: tone.color,
          boxShadow: tone.boxShadow,
        } as CSSProperties;

        return (
          <section
            key={item.id}
            className="touchspace-incoming-alert-card pointer-events-auto overflow-hidden rounded-[24px] border"
            style={cardStyle}
          >
            <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
              <p className="text-[15px] font-semibold tracking-[0.01em] text-inherit">Входящее сообщение</p>
              <button
                type="button"
                onClick={(event) => {
                  stopNotificationAction(event);
                  onClose(item.id);
                }}
                onMouseDown={stopNotificationAction}
                onMouseUp={stopNotificationAction}
                onPointerDown={stopNotificationAction}
                onPointerUp={stopNotificationAction}
                className="relative -mr-1.5 -mt-1.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white/15 text-transparent outline-none transition hover:bg-white/25 active:scale-95 focus:outline-none focus-visible:outline-none"
                aria-label="Закрыть уведомление"
              >
                <span className="absolute h-[2.5px] w-4 rotate-45 rounded-full bg-white" />
                <span className="absolute h-[2.5px] w-4 -rotate-45 rounded-full bg-white" />
              </button>
            </div>

            <div
              className="flex cursor-pointer gap-4 px-5 pb-5"
              onClick={() => onPrimary?.(item.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPrimary?.(item.id);
                }
              }}
            >
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                style={{ backgroundColor: item.avatarColor || "rgba(255,255,255,0.24)" }}
              >
                {item.avatarEmoji || getInitialAvatar(item.title)}
              </div>

              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[15px] font-medium leading-[1.35] text-inherit">
                  {item.title}
                </p>
                {item.subtitle ? (
                  <p className="mt-1 text-sm text-inherit opacity-90">{item.subtitle}</p>
                ) : null}
                <p className="mt-4 line-clamp-2 text-[15px] leading-[1.45] text-inherit opacity-95">
                  {item.preview}
                </p>
                {item.metaLabel ? (
                  <p className="mt-3 text-xs font-medium text-inherit opacity-80">{item.metaLabel}</p>
                ) : null}
              </div>
            </div>

            <div
              className="touchspace-incoming-alert-footer grid grid-cols-2 gap-0 border-t px-2 py-2"
              style={{
                backgroundColor: tone.footerBackgroundColor,
                borderColor: tone.footerBorderColor,
              }}
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onPrimary?.(item.id);
                }}
                className="rounded-[16px] px-4 py-3 text-sm font-medium text-inherit transition hover:bg-white/10"
              >
                {item.primaryLabel ?? "Ответить"}
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  if (onSecondary) {
                    onSecondary(item.id);
                    return;
                  }
                  onClose(item.id);
                }}
                className="rounded-[16px] px-4 py-3 text-sm font-medium text-inherit opacity-90 transition hover:bg-white/10"
              >
                {item.secondaryLabel ?? "Позже"}
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
