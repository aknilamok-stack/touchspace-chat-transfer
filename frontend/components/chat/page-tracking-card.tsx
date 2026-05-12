"use client";

import { useMemo, useState } from "react";

export type ChatPageViewItem = {
  id: string;
  pageUrl: string;
  pagePath: string;
  pageTitle?: string | null;
  pageName?: string | null;
  routeType?: string | null;
  entityId?: string | null;
  entityName?: string | null;
  referrer?: string | null;
  sourceType: string;
  visitedAt: string;
};

type PageTrackingCardProps = {
  current: ChatPageViewItem | null;
  items: ChatPageViewItem[];
  isLoading?: boolean;
  error?: string;
  className?: string;
};

const formatVisitedTime = (value: string) => {
  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return "";
  }

  return parsedDate.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getItemTitle = (item: ChatPageViewItem) =>
  item.pageName?.trim() || item.entityName?.trim() || item.pageTitle?.trim() || "Страница";

const getItemLink = (item: ChatPageViewItem) => item.pageUrl?.trim() || item.pagePath?.trim() || "";

export function PageTrackingCard({
  current,
  items,
  isLoading = false,
  error = "",
  className = "",
}: PageTrackingCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  const historyItems = useMemo(() => {
    const uniqueItems: ChatPageViewItem[] = [];
    const seenIds = new Set<string>();

    items.forEach((item) => {
      if (seenIds.has(item.id)) {
        return;
      }

      seenIds.add(item.id);
      uniqueItems.push(item);
    });

    return uniqueItems.slice(0, 10);
  }, [items]);

  const effectiveCurrent = current ?? historyItems[0] ?? null;
  const currentLink = effectiveCurrent ? getItemLink(effectiveCurrent) : "";

  if (!isLoading && !error && !effectiveCurrent && historyItems.length === 0) {
    return null;
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-2 text-[13px] text-[#8E8E93]">
        <span className="shrink-0">Чат на сайте</span>
        {isLoading ? (
          <span className="truncate text-[#8E8E93]">Загружаем переходы...</span>
        ) : error ? (
          <span className="truncate text-[#D63E3E]">{error}</span>
        ) : effectiveCurrent && currentLink ? (
          <a
            href={currentLink}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[#0A84FF] underline decoration-[#B9D6FF] underline-offset-2 transition hover:text-[#0077F2]"
            title={currentLink}
          >
            {currentLink}
          </a>
        ) : (
          <span className="truncate text-[#8E8E93]">Нет данных о переходах</span>
        )}
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[#8E8E93] transition hover:bg-[#F2F6FC] hover:text-[#1E1E1E]"
          aria-label={isOpen ? "Скрыть историю страниц" : "Показать историю страниц"}
        >
          <span
            className={`text-[11px] transition ${isOpen ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
      </div>

      {isOpen ? (
        <div className="absolute left-0 top-full z-20 mt-2 w-full max-w-[620px] rounded-[18px] border border-[#E7EBF3] bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8E8E93]">
            Последние 10 страниц
          </p>

          {historyItems.length === 0 ? (
            <p className="text-sm text-[#8E8E93]">История переходов пока пуста</p>
          ) : (
            <div className="space-y-2">
              {historyItems.map((item) => {
                const itemLink = getItemLink(item);

                return (
                  <div key={item.id} className="rounded-[14px] bg-[#F7F8FB] px-3 py-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[#1E1E1E]">
                          {getItemTitle(item)}
                        </p>
                        {itemLink ? (
                          <a
                            href={itemLink}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-0.5 block truncate text-xs text-[#0A84FF] underline decoration-[#B9D6FF] underline-offset-2 transition hover:text-[#0077F2]"
                            title={itemLink}
                          >
                            {itemLink}
                          </a>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-xs text-[#8E8E93]">
                        {formatVisitedTime(item.visitedAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
