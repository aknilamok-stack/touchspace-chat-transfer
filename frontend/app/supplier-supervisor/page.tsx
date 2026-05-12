"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import { ChatAttachmentList } from "@/components/chat/attachment-card";
import { DialogListCard } from "@/components/chat/dialog-list-card";
import { MessageStatusChecks } from "@/components/chat/message-status-checks";
import { ContactCard, type ChatContactItem } from "@/components/chat/contact-card";
import { PageTrackingCard, type ChatPageViewItem } from "@/components/chat/page-tracking-card";
import { IncomingAlertStack } from "@/components/notifications/incoming-alert-stack";
import {
  clearAuthSession,
  getHomePathForRole,
  logoutServerSession,
  managerAccounts,
  type ManagerPresence,
  readAuthSession,
} from "@/lib/auth";
import {
  CHAT_ATTACHMENT_ACCEPT,
  type ChatAttachmentPayload,
  getChatAttachmentSelectionSummary,
  parseChatAttachmentPayloads,
  validateChatAttachmentFiles,
} from "@/lib/chat-attachments";
import { formatDialogActivityLabel } from "@/lib/dialog-list";
import {
  getSupplierRequestSyncState,
  isSupplierSyncControlMessage,
} from "@/lib/supplier-request-sync";
import {
  fetchManagerStatuses,
  fetchSupplierStatuses,
  updateSupplierPresence,
} from "@/lib/manager-presence";
import { playNotificationSound } from "@/lib/notification-sound";
import {
  isDesktopShell,
  shouldShowDesktopBackgroundNotification,
  showDesktopShellNotification,
} from "@/lib/runtime";

const supplierStatusStorageKey = "touchspace_supplier_status";
const supplierPinnedRequestsStorageKey = "touchspace_supplier_pinned_requests";
const supplierReplyMapStorageKey = "touchspace_supplier_reply_map";
const supplierSupervisorPowerStorageKey = "touchspace_supplier_supervisor_power_enabled";
const supplierStatusLabels: Record<ManagerPresence, string> = {
  online: "В сети",
  break: "На перерыве",
  offline: "Не в сети",
};
const supplierStatusDots: Record<ManagerPresence, string> = {
  online: "bg-[#34C759]",
  break: "bg-[#FFB340]",
  offline: "bg-[#C7C7CC]",
};
const QUICK_REPLIES = [
  "Добрый день! Чем могу помочь?",
  "Минуту, уточню ваш запрос",
  "Проверяю наличие и срок поставки",
  "Можете уточнить номер заказа?",
  "Благодарю, информацию передал",
];
const EMOJI_REACTIONS = ["🙂", "😊", "😉", "🤝", "👍", "✅", "🔥", "❤️", "😂", "🙏"];
const REPEATED_NOTIFICATION_INTERVAL_MS = 40_000;
const CLIENT_ON_SITE_ACTIVITY_TTL_MS = 90_000;

type SupplierRequest = {
  id: string;
  ticketId: string;
  supplierId?: string | null;
  supplierName: string;
  assignedSupplierProfileId?: string | null;
  assignedSupplierProfileName?: string | null;
  requestText: string;
  status: string;
  claimRequiredAt?: string | null;
  claimMissedAt?: string | null;
  returnedToQueueAt?: string | null;
  slaMinutes?: number | null;
  createdByManagerId?: string | null;
  claimedAt?: string | null;
  firstResponseAt?: string | null;
  responseTime?: number | null;
  responseBreached?: boolean;
  supplierSyncPaused?: boolean;
  supplierSyncMode?: "live" | "paused" | "awaiting_manager";
  supplierSyncAwaitingManager?: boolean;
  supplierSyncPausedAt?: string | null;
  supplierSyncResumedAt?: string | null;
  supplierSyncResumeRequestedAt?: string | null;
  supplierSyncResumeDeferredAt?: string | null;
  supplierSyncManagerPromptAvailableAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
};

type TicketMessageApi = {
  id: string;
  content: string;
  senderType: string;
  senderName?: string | null;
  senderProfileId?: string | null;
  isInternal?: boolean;
  replyToMessageId?: string | null;
  replyToContent?: string | null;
  messageType?: string;
  transport?: string | null;
  status: string;
  ticketId: string;
  createdAt: string;
};

type TicketMessage = TicketMessageApi & {
  displayContent: string;
  attachment?: ChatAttachmentPayload | null;
  attachments?: ChatAttachmentPayload[];
};

type SupplierTimelineItem =
  | {
      kind: "request";
      id: string;
      createdAt: string;
      request: SupplierRequest;
    }
  | {
      kind: "message";
      id: string;
      createdAt: string;
      message: TicketMessage;
    };

type ApiTicketContactsResponse = {
  items?: ChatContactItem[];
};
type ApiTicketPageViewsResponse = {
  current?: ChatPageViewItem | null;
  items?: ChatPageViewItem[];
};
type ReplyMeta = {
  replyToId: string;
  replyToContent: string;
};

type EditMeta = {
  messageId: string;
  originalText: string;
};

type ToastTone = "success" | "error" | "info";

type UiToast = {
  message: string;
  tone: ToastTone;
};

type SupplierNotificationCandidate = {
  notificationKey: string;
  ticketId: string;
  requestId?: string | null;
  title: string;
  messageId: string;
  messageText: string;
  createdAt: string;
  tradePointName?: string | null;
  avatarColor?: string | null;
  avatarEmoji?: string | null;
  scopeStatus:
    | "new_unclaimed"
    | "missed_unclaimed"
    | "owned_active"
    | "claimed_by_other_recently";
  waitSeconds: number;
  assignedSupplierProfileId?: string | null;
  assignedSupplierProfileName?: string | null;
  kind: "message" | "request";
};

type Ticket = {
  id: string;
  title: string;
  status?: string;
  pinned?: boolean;
  clientId?: string | null;
  clientName?: string | null;
  tradePointName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  currentUserEmail?: string | null;
  currentUserPhone?: string | null;
  superuserEmail?: string | null;
  superuserPhone?: string | null;
  canonicalEmail?: string | null;
  avatarColor?: string | null;
  avatarEmoji?: string | null;
  assignedManagerId?: string | null;
  assignedManagerName?: string | null;
  lastResolvedByManagerName?: string | null;
  lastMessageAt?: string | null;
  invitedManagerNames?: string[];
};

type SupplierQueueTab = "new" | "in_progress" | "completed";

type SupplierRequestCard = {
  request: SupplierRequest;
  requests: SupplierRequest[];
  queueTab: SupplierQueueTab;
  managerName: string;
  pinned: boolean;
  lastActivityAt: string;
  lastVisibleMessage: TicketMessage | null;
  ticket: Ticket | null;
};

type SupplierPanelStatus = {
  label: string;
  badgeClassName: string;
  cardClassName: string;
  accentClassName: string;
};

type SupplierSlaVisual = {
  label: string;
  status: string;
  time: string;
  progress: string;
  bar: string;
  tone: string;
};

type SupplierRequestHistoryFilter = "all" | "day" | "week" | "month" | "custom";

const appFontFamily = "Montserrat, ui-sans-serif, system-ui, sans-serif";
const getMessageDayKey = (createdAt: string) => {
  const date = new Date(createdAt);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const formatMessageDayLabel = (createdAt: string) =>
  new Date(createdAt).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const escapeSearchRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const renderHighlightedText = (text: string, query: string) => {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return text;
  }

  const pattern = new RegExp(`(${escapeSearchRegExp(normalizedQuery)})`, "ig");
  const parts = text.split(pattern);

  return parts.map((part, index) =>
    part.toLowerCase() === normalizedQuery.toLowerCase() ? (
      <mark
        key={`${part}-${index}`}
        className="rounded bg-[#FFE08A] px-0.5 text-inherit"
      >
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  );
};

const formatTimeLabel = (createdAt: string) =>
  new Date(createdAt).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

const formatDateTimeLabel = (createdAt: string) =>
  new Date(createdAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const sanitizeSupplierDisplaySegment = (value?: string | null) => {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return "";
  }

  return normalizedValue
    .replace(/^(?:(?:supplier|scope)[\s_-]*)+/i, "")
    .replace(/^[\/\s_-]+/, "")
    .trim();
};

const formatSupplierCompanyName = (supplierId?: string, fallback?: string) => {
  const normalizeCompanyLabel = (value?: string | null) => {
    const sanitizedValue = sanitizeSupplierDisplaySegment(value);

    if (!sanitizedValue) {
      return "";
    }

    return sanitizedValue
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  };

  const normalizedSupplierId = normalizeCompanyLabel(supplierId);

  if (normalizedSupplierId) {
    return normalizedSupplierId;
  }

  const normalizedFallback = normalizeCompanyLabel(fallback);

  if (normalizedFallback) {
    return normalizedFallback;
  }

  return "Поставщик";
};

const isSameLocalDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

const isSpecificManagerName = (name?: string | null) => {
  const normalizedName = name?.trim().toLowerCase();
  return Boolean(normalizedName && normalizedName !== "менеджер" && normalizedName !== "manager");
};

const getSupplierMessageAuthorLabel = (message: TicketMessage) => {
  if (message.senderType === "supplier") {
    return "Вы";
  }

  if (message.senderType === "manager") {
    const managerName = message.senderName?.trim();
    return isSpecificManagerName(managerName)
      ? `Менеджер / ${managerName}`
      : "Менеджер";
  }

  if (message.senderType === "client") {
    return "Клиент";
  }

  return "";
};

const formatTicketMessage = (message: TicketMessageApi): TicketMessage => {
  const attachments = parseChatAttachmentPayloads(message.content);
  const normalizedContent = message.content.trim();
  const isSupplierResolvedSystemMessage =
    message.senderType === "system" &&
    normalizedContent.startsWith("Запрос поставщику ") &&
    normalizedContent.includes('переведён в статус "Решён"');

  return {
    ...message,
    displayContent:
      isSupplierResolvedSystemMessage
        ? "Диалог решён"
        : message.messageType === "attachment" && attachments.length > 0
        ? attachments.length === 1
          ? attachments[0].name
          : `${attachments.length} файлов`
        : message.content,
    replyToMessageId: message.replyToMessageId ?? null,
    replyToContent: message.replyToContent ?? null,
    senderProfileId: message.senderProfileId ?? null,
    isInternal: Boolean(message.isInternal),
    transport: message.transport ?? null,
    attachment: attachments[0] ?? null,
    attachments,
  };
};

const getReplyPreviewContent = (message: TicketMessage) => {
  if (message.attachments && message.attachments.length > 0) {
    return message.attachments.length === 1
      ? message.attachments[0].name
      : `${message.attachments.length} файлов`;
  }

  return message.displayContent;
};

const supplierQueueTabs: Array<{
  id: SupplierQueueTab;
  label: string;
  activeClassName: string;
  badgeClassName: string;
}> = [
  {
    id: "new",
    label: "Новые",
    activeClassName: "bg-[#0A84FF] text-white shadow-[0_10px_22px_rgba(10,132,255,0.24)]",
    badgeClassName: "bg-[#EAF3FF] text-[#0A84FF]",
  },
  {
    id: "in_progress",
    label: "В работе",
    activeClassName: "bg-[#FFB340] text-white shadow-[0_10px_22px_rgba(255,179,64,0.22)]",
    badgeClassName: "bg-[#FFF4DE] text-[#B7791F]",
  },
  {
    id: "completed",
    label: "Завершённые",
    activeClassName: "bg-[#8E8E93] text-white shadow-[0_10px_22px_rgba(142,142,147,0.2)]",
    badgeClassName: "bg-[#F2F2F7] text-[#6C6C70]",
  },
];

const managerNameById = Object.fromEntries(
  managerAccounts.map((manager) => [manager.id, manager.name])
);
const uniqueManagers = Array.from(
  new Map(managerAccounts.map((manager) => [manager.id, manager])).values()
);

const areRequestsEqual = (
  left: SupplierRequest[],
  right: SupplierRequest[]
) =>
  left.length === right.length &&
  left.every((request, index) => {
    const nextRequest = right[index];

    return (
      request.id === nextRequest?.id &&
      request.status === nextRequest.status &&
      request.requestText === nextRequest.requestText &&
      request.createdAt === nextRequest.createdAt &&
      request.supplierSyncPaused === nextRequest.supplierSyncPaused &&
      request.supplierSyncPausedAt === nextRequest.supplierSyncPausedAt &&
      request.supplierSyncResumedAt === nextRequest.supplierSyncResumedAt
    );
  });

const areMessageMapsEqual = (
  left: Record<string, TicketMessage[]>,
  right: Record<string, TicketMessage[]>
) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => areMessagesEqual(left[key] ?? [], right[key] ?? []));
};

const getVisibleMessagesForTicket = (
  requests: SupplierRequest[],
  messages: TicketMessage[]
) => {
  const sortedRequests = [...requests].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );

  return messages.filter((message) => {
    const messageCreatedAt = new Date(message.createdAt).getTime();

    if (!Number.isFinite(messageCreatedAt)) {
      return false;
    }

    if (isSupplierSyncControlMessage(message)) {
      return false;
    }

    const isDuplicatedSupplierRequestSystemMessage =
      message.senderType === "system" &&
      typeof message.displayContent === "string" &&
      message.displayContent.startsWith("Запрошен поставщик:");

    const isSupplierClaimSystemMessage =
      message.senderType === "system" &&
      typeof message.displayContent === "string" &&
      message.displayContent.startsWith("Поставщик ") &&
      message.displayContent.includes("взял запрос в работу");

    const isSupplierResolvedSystemMessage =
      message.senderType === "system" &&
      (message.displayContent === "Диалог решён" ||
        message.content.includes('переведён в статус "Решён"'));

    if (isDuplicatedSupplierRequestSystemMessage || isSupplierClaimSystemMessage) {
      return false;
    }

    const fallsIntoVisibleRequestWindow = sortedRequests.some((request, index) => {
      const requestStartedAt = new Date(request.createdAt).getTime();
      const nextRequestStartedAt =
        index < sortedRequests.length - 1
          ? new Date(sortedRequests[index + 1].createdAt).getTime()
          : Number.POSITIVE_INFINITY;

      if (
        !Number.isFinite(requestStartedAt) ||
        messageCreatedAt < requestStartedAt ||
        messageCreatedAt >= nextRequestStartedAt
      ) {
        return false;
      }

      const requestClosedAt = request.closedAt ? new Date(request.closedAt).getTime() : null;

      if (
        typeof requestClosedAt === "number" &&
        Number.isFinite(requestClosedAt) &&
        messageCreatedAt > requestClosedAt
      ) {
        return isSupplierResolvedSystemMessage && messageCreatedAt - requestClosedAt <= 10_000;
      }

      if (
        (message.senderType === "manager" && !message.isInternal) ||
        message.senderType === "client"
      ) {
        const syncState = getSupplierRequestSyncState(sortedRequests, messages, request.id);

        return syncState.visibleIntervals.some(
          (interval) =>
            messageCreatedAt >= interval.start && messageCreatedAt < interval.end
        );
      }

      return true;
    });

    return (
      fallsIntoVisibleRequestWindow &&
      (
        message.senderType === "client" ||
        message.senderType === "supplier" ||
        message.senderType === "system" ||
        message.senderType === "manager"
      )
    );
  });
};

const buildSupplierTimelineItems = (
  requests: SupplierRequest[],
  messages: TicketMessage[]
): SupplierTimelineItem[] =>
  [
    ...requests.map(
      (request) =>
        ({
          kind: "request",
          id: `request-${request.id}`,
          createdAt: request.createdAt,
          request,
        }) satisfies SupplierTimelineItem
    ),
    ...messages.map(
      (message) =>
        ({
          kind: "message",
          id: `message-${message.id}`,
          createdAt: message.createdAt,
          message,
        }) satisfies SupplierTimelineItem
    ),
  ].sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    if (left.kind !== right.kind) {
      return left.kind === "request" ? -1 : 1;
    }

    return left.id.localeCompare(right.id);
  });

const getSupplierQueueTab = (
  request: SupplierRequest,
  ticketStatus?: string
): SupplierQueueTab => {
  const isRequestClosed = ["closed", "cancelled", "resolved"].includes(request.status);

  if (ticketStatus === "resolved" || isRequestClosed) {
    return "completed";
  }

  if (request.status === "pending") {
    return "new";
  }

  return "in_progress";
};

const isSupplierRequestMine = (
  request: SupplierRequest,
  supplierProfileId: string
) => {
  if (request.status === "pending") {
    return false;
  }

  if (!request.assignedSupplierProfileId || !supplierProfileId) {
    return false;
  }

  return request.assignedSupplierProfileId === supplierProfileId;
};

const buildSupplierRequestCards = (
  requests: SupplierRequest[],
  ticketMessagesByTicketId: Record<string, TicketMessage[]>,
  pinnedRequestIds: string[],
  ticketsById: Record<string, Ticket>
) =>
  Object.values(
    requests.reduce<Record<string, SupplierRequest[]>>((accumulator, request) => {
      if (!accumulator[request.ticketId]) {
        accumulator[request.ticketId] = [];
      }

      accumulator[request.ticketId].push(request);
      return accumulator;
    }, {})
  )
    .map((ticketRequests) => {
      const sortedRequests = [...ticketRequests].sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
      const request = sortedRequests[0];
      const requestMessages = ticketMessagesByTicketId[request.ticketId] ?? [];
      const visibleMessages = getVisibleMessagesForTicket(sortedRequests, requestMessages);
      const lastVisibleMessage = visibleMessages[visibleMessages.length - 1] ?? null;
      const ticketStatus = ticketsById[request.ticketId]?.status;
      const activeRequest =
        sortedRequests.find(
          (item) => !["closed", "cancelled", "resolved"].includes(item.status)
        ) ?? request;

      return {
        request: activeRequest,
        requests: sortedRequests,
        queueTab: getSupplierQueueTab(activeRequest, ticketStatus),
        managerName:
          (activeRequest.createdByManagerId
            ? managerNameById[activeRequest.createdByManagerId]
            : undefined) ?? "Не указан",
        pinned: pinnedRequestIds.includes(request.ticketId),
        lastActivityAt: lastVisibleMessage?.createdAt ?? request.createdAt,
        lastVisibleMessage,
        ticket: ticketsById[request.ticketId] ?? null,
      } satisfies SupplierRequestCard;
    })
    .sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        new Date(right.lastActivityAt).getTime() - new Date(left.lastActivityAt).getTime()
    );

const fetchTicketMessagesSnapshot = async (
  ticketId: string,
  supplierId: string
): Promise<TicketMessage[]> => {
  const response = await fetch(
    apiUrl(
      `/tickets/${ticketId}/messages?viewerType=supplier&viewerId=${encodeURIComponent(
        supplierId
      )}`
    )
  );

  if (!response.ok) {
    throw new Error("Не удалось загрузить сообщения тикета");
  }

  const data = (await response.json()) as TicketMessageApi[];
  return data.map(formatTicketMessage);
};

const getSupplierCardClientLabel = (ticket: Ticket | null, request: SupplierRequest) =>
  ticket?.tradePointName?.trim() ||
  ticket?.clientName?.trim() ||
  ticket?.clientId?.trim() ||
  ticket?.title?.trim() ||
  `Ticket #${request.ticketId}`;

const getSupplierCardPreview = (card: SupplierRequestCard) => {
  if (card.lastVisibleMessage) {
    if (card.lastVisibleMessage.attachments && card.lastVisibleMessage.attachments.length > 0) {
      return card.lastVisibleMessage.attachments.length === 1
        ? card.lastVisibleMessage.attachments[0].name
        : `${card.lastVisibleMessage.attachments.length} файлов`;
    }

    return card.lastVisibleMessage.displayContent.length > 84
      ? `${card.lastVisibleMessage.displayContent.slice(0, 84)}...`
      : card.lastVisibleMessage.displayContent;
  }

  if (card.request.requestText.trim()) {
    return card.request.requestText.length > 84
      ? `${card.request.requestText.slice(0, 84)}...`
      : card.request.requestText;
  }

  return "Диалог создан";
};

const getSupplierCardTone = (
  request: SupplierRequest,
  queueTab: SupplierQueueTab
) => {
  if (queueTab === "new" && request.returnedToQueueAt) {
    return {
      dot: "bg-[#FF7A00]",
      pill: "bg-[#FFF1E8] text-[#C35A00]",
      label: "Возвращён в очередь",
    };
  }

  if (queueTab === "new" && request.claimMissedAt) {
    return {
      dot: "bg-[#FD6868]",
      pill: "bg-[#FFE7E7] text-[#D64545]",
      label: "Пропущен",
    };
  }

  if (queueTab === "new") {
    return {
      dot: "bg-[#0A84FF]",
      pill: "bg-[#EAF3FF] text-[#0A84FF]",
      label: "Новый",
    };
  }

  if (queueTab === "completed") {
    return {
      dot: "bg-[#8E8E93]",
      pill: "bg-[#F2F2F7] text-[#6C6C70]",
      label: "Завершён",
    };
  }

  return {
    dot: "bg-[#FFB340]",
    pill: "bg-[#FFF4DE] text-[#B7791F]",
    label: "В работе",
  };
};

const fetchMessagesMapForRequests = async (
  requests: SupplierRequest[],
  supplierId: string
) => {
  const uniqueTicketIds = [...new Set(requests.map((request) => request.ticketId))];
  const ticketEntries = await Promise.all(
    uniqueTicketIds.map(async (ticketId) => [
      ticketId,
      await fetchTicketMessagesSnapshot(ticketId, supplierId),
    ] as const)
  );

  return Object.fromEntries(ticketEntries);
};

const fetchTicketsMap = async (supplierId: string) => {
  const response = await fetch(
    apiUrl(`/tickets?viewerType=supplier&viewerId=${encodeURIComponent(supplierId)}`)
  );

  if (!response.ok) {
    throw new Error("Не удалось загрузить тикеты");
  }

  const tickets = (await response.json()) as Ticket[];

  return Object.fromEntries(tickets.map((ticket) => [ticket.id, ticket]));
};

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.max(Math.floor(durationMs / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} ч ${minutes} мин`;
  }

  if (minutes > 0) {
    return `${minutes} мин ${seconds} сек`;
  }

  return `${seconds} сек`;
};

const buildSupplierPanelStatus = ({
  request,
  ticketStatus,
  queueTab,
}: {
  request: SupplierRequest;
  ticketStatus?: string;
  queueTab?: SupplierQueueTab;
}): SupplierPanelStatus => {
  if (
    ticketStatus === "resolved" ||
    request.status === "closed" ||
    request.status === "cancelled" ||
    request.status === "resolved"
  ) {
    return {
      label: "Завершён",
      badgeClassName: "bg-[#ECFFF1] text-[#1F8B4C]",
      cardClassName: "border-[#D9F3E3] bg-[#F7FFF9]",
      accentClassName: "bg-[#34C759]",
    };
  }

  if (ticketStatus === "waiting_client") {
    return {
      label: "Ждём клиента",
      badgeClassName: "bg-[#FFF5E8] text-[#B7791F]",
      cardClassName: "border-[#F4E3C2] bg-[#FFFBF4]",
      accentClassName: "bg-[#FFB340]",
    };
  }

  if (queueTab === "new") {
    if (request.returnedToQueueAt) {
      return {
        label: "Возвращён в очередь",
        badgeClassName: "bg-[#FFF1E8] text-[#C35A00]",
        cardClassName: "border-[#FFD8BE] bg-[#FFF8F2]",
        accentClassName: "bg-[#FF7A00]",
      };
    }

    if (request.claimMissedAt) {
      return {
        label: "Пропущенный запрос",
        badgeClassName: "bg-[#FFE7E7] text-[#D64545]",
        cardClassName: "border-[#FFD3D3] bg-[#FFF8F8]",
        accentClassName: "bg-[#FF3B30]",
      };
    }

    return {
      label: "Новый запрос",
      badgeClassName: "bg-[#FFE7E7] text-[#D64545]",
      cardClassName: "border-[#FFD3D3] bg-[#FFF8F8]",
      accentClassName: "bg-[#FF3B30]",
    };
  }

  return {
    label: "В работе",
    badgeClassName: "bg-[#EEF6FF] text-[#0A84FF]",
    cardClassName: "border-[#DCE7FF] bg-[#F7FAFF]",
    accentClassName: "bg-[#0A84FF]",
  };
};

const buildSupplierSlaVisual = ({
  request,
  now,
}: {
  request: SupplierRequest;
  now: number;
}): SupplierSlaVisual => {
  const slaMs = Math.max((request.slaMinutes ?? 60) * 60 * 1000, 60 * 1000);
  const startedAt = new Date(request.createdAt).getTime();

  if (request.firstResponseAt && request.responseTime !== null && request.responseTime !== undefined) {
    return {
      label: "Ответ поставщика",
      status: request.responseBreached ? "Ответ просрочен" : "Ответ получен",
      time: `Ответ за ${formatDuration(request.responseTime)}`,
      progress: "100%",
      bar: request.responseBreached ? "bg-[#FD6868]" : "bg-[#34C759]",
      tone: request.responseBreached ? "text-[#D64545]" : "text-[#1F8B4C]",
    };
  }

  const elapsedMs = Math.max(now - startedAt, 0);
  const remainingMs = slaMs - elapsedMs;
  const ratio = Math.min(elapsedMs / slaMs, 1);

  if (remainingMs <= 0) {
    return {
      label: "Ответ поставщика",
      status: "Ответ просрочен",
      time: `Просрочка ${formatDuration(Math.abs(remainingMs))}`,
      progress: "100%",
      bar: "bg-[#FD6868]",
      tone: "text-[#D64545]",
    };
  }

  if (ratio >= 0.75) {
    return {
      label: "Ответ поставщика",
      status: "Скоро дедлайн",
      time: `${formatDuration(remainingMs)} осталось`,
      progress: `${Math.max(ratio * 100, 8)}%`,
      bar: "bg-[#FD6868]",
      tone: "text-[#D64545]",
    };
  }

  if (ratio >= 0.5) {
    return {
      label: "Ответ поставщика",
      status: "Нужно ответить",
      time: `${formatDuration(remainingMs)} осталось`,
      progress: `${Math.max(ratio * 100, 8)}%`,
      bar: "bg-[#FFB340]",
      tone: "text-[#B7791F]",
    };
  }

  return {
    label: "Ответ поставщика",
    status: "В норме",
    time: `${formatDuration(remainingMs)} осталось`,
    progress: `${Math.max(ratio * 100, 8)}%`,
    bar: "bg-[#34C759]",
    tone: "text-[#1F8B4C]",
  };
};

const getSupplierRequestStatusLabel = (status?: string) => {
  if (status === "pending") {
    return "Новый";
  }

  if (status === "in_progress") {
    return "В работе";
  }

  if (status === "answered") {
    return "Отвечен";
  }

  if (status === "closed" || status === "resolved") {
    return "Решён";
  }

  if (status === "cancelled") {
    return "Отменён";
  }

  return status || "—";
};

const areMessagesEqual = (
  left: TicketMessage[],
  right: TicketMessage[]
) =>
  left.length === right.length &&
  left.every((message, index) => {
    const nextMessage = right[index];

    return (
      message.id === nextMessage?.id &&
      message.content === nextMessage.content &&
      message.messageType === nextMessage.messageType &&
      message.status === nextMessage.status &&
      message.senderType === nextMessage.senderType &&
      message.createdAt === nextMessage.createdAt
    );
  });

export default function SupplierPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [supplierProfileId, setSupplierProfileId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierEmployeeName, setSupplierEmployeeName] = useState("");
  const [supplierSupervisorPowerEnabled, setSupplierSupervisorPowerEnabled] = useState(true);
  const [supplierStatus, setSupplierStatus] = useState<ManagerPresence>("online");
  const [isSupplierMenuOpen, setIsSupplierMenuOpen] = useState(false);
  const [supplierRequests, setSupplierRequests] = useState<SupplierRequest[]>([]);
  const [pinnedRequestIds, setPinnedRequestIds] = useState<string[]>([]);
  const [ticketsById, setTicketsById] = useState<Record<string, Ticket>>({});
  const [activeQueueTab, setActiveQueueTab] = useState<SupplierQueueTab>("new");
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [isChatPaneDismissed, setIsChatPaneDismissed] = useState(false);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  const [ticketMessagesByTicketId, setTicketMessagesByTicketId] = useState<
    Record<string, TicketMessage[]>
  >({});
  const [hoveredHeaderAction, setHoveredHeaderAction] = useState<string | null>(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [selectedInvitedManagerId, setSelectedInvitedManagerId] = useState<string>(
    managerAccounts[0]?.id ?? ""
  );
  const [selectedTransferManagerId, setSelectedTransferManagerId] = useState<string>(
    managerAccounts[0]?.id ?? ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [activeChatSearchMatchIndex, setActiveChatSearchMatchIndex] = useState(0);
  const [replyText, setReplyText] = useState("");
  const [sendMode, setSendMode] = useState<"chat" | "email">("chat");
  const [emailRecipient, setEmailRecipient] = useState("");
  const [quickReplies, setQuickReplies] = useState<string[]>(QUICK_REPLIES);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [quickReplySearch, setQuickReplySearch] = useState("");
  const [isQuickReplyModalOpen, setIsQuickReplyModalOpen] = useState(false);
  const [newQuickReplyText, setNewQuickReplyText] = useState("");
  const [replyTarget, setReplyTarget] = useState<TicketMessage | null>(null);
  const [editTarget, setEditTarget] = useState<EditMeta | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState("");
  const [hoveredEditMessageId, setHoveredEditMessageId] = useState("");
  const [replyMap, setReplyMap] = useState<Record<string, ReplyMeta>>({});
  const [highlightedReplyMessageId, setHighlightedReplyMessageId] = useState("");
  const [hoveredComposerAction, setHoveredComposerAction] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [isResumingSupplierSync, setIsResumingSupplierSync] = useState(false);
  const [isTogglingPinned, setIsTogglingPinned] = useState(false);
  const [isInvitingManager, setIsInvitingManager] = useState(false);
  const [isTransferringDialog, setIsTransferringDialog] = useState(false);
  const [isResolvingTicket, setIsResolvingTicket] = useState(false);
  const [toast, setToast] = useState<UiToast | null>(null);
  const [requestsError, setRequestsError] = useState("");
  const [messagesError, setMessagesError] = useState("");
  const [replyError, setReplyError] = useState("");
  const [pinError, setPinError] = useState("");
  const [inviteManagerError, setInviteManagerError] = useState("");
  const [transferDialogError, setTransferDialogError] = useState("");
  const [deepLinkRequestId, setDeepLinkRequestId] = useState("");
  const [deepLinkTicketId, setDeepLinkTicketId] = useState("");
  const [requestHistoryFilter, setRequestHistoryFilter] =
    useState<SupplierRequestHistoryFilter>("all");
  const [requestHistoryCustomDate, setRequestHistoryCustomDate] = useState("");
  const [managerStatuses, setManagerStatuses] = useState<Record<string, ManagerPresence>>({});
  const [supplierStatuses, setSupplierStatuses] = useState<Record<string, ManagerPresence>>({});
  const [notificationCandidates, setNotificationCandidates] = useState<
    SupplierNotificationCandidate[]
  >([]);
  const [notificationNow, setNotificationNow] = useState(() => Date.now());
  const [dismissedNotificationUntil, setDismissedNotificationUntil] = useState<Record<string, number>>({});
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [pendingClientMessageCount, setPendingClientMessageCount] = useState(0);
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const [ticketContacts, setTicketContacts] = useState<ChatContactItem[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const [ticketPageViews, setTicketPageViews] = useState<ChatPageViewItem[]>([]);
  const [currentPageView, setCurrentPageView] = useState<ChatPageViewItem | null>(null);
  const [isLoadingPageViews, setIsLoadingPageViews] = useState(false);
  const [pageViewsError, setPageViewsError] = useState("");
  const supplierMenuRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const quickRepliesRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const supplierIsNearBottomRef = useRef(true);
  const previousSelectedRequestIdRef = useRef("");
  const previousSupplierTimelineItemCountRef = useRef(0);
  const previousVisibleMessageCountRef = useRef(0);
  const visibleSupplierMessagesRef = useRef<TicketMessage[]>([]);
  const messageElementsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightedReplyTimeoutRef = useRef<number | null>(null);
  const replyHoverTimeoutRef = useRef<number | null>(null);
  const lastNotificationAtRef = useRef<Record<string, number>>({});
  const lastNotificationMessageIdRef = useRef<Record<string, string>>({});
  const defaultDocumentTitleRef = useRef("");
  const visibleNotificationRequestIdsRef = useRef<Set<string>>(new Set());
  const titleFlashIntervalRef = useRef<number | null>(null);

  const selectedRequest =
    supplierRequests.find((request) => request.id === selectedRequestId) ?? null;
  const selectedTicket = selectedRequest ? ticketsById[selectedRequest.ticketId] ?? null : null;
  const selectedTicketRequests = selectedRequest
    ? supplierRequests
        .filter((request) => request.ticketId === selectedRequest.ticketId)
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        )
    : [];
  const selectedActiveRequest =
    selectedTicketRequests.find(
      (request) => !["closed", "cancelled", "resolved"].includes(request.status)
    ) ?? selectedRequest;
  const currentPageViewAgeMs = currentPageView?.visitedAt
    ? (currentTimeMs ?? Date.now()) - new Date(currentPageView.visitedAt).getTime()
    : null;
  const clearReplyHoverTimeout = useCallback(() => {
    if (replyHoverTimeoutRef.current !== null) {
      window.clearTimeout(replyHoverTimeoutRef.current);
      replyHoverTimeoutRef.current = null;
    }
  }, []);

  const showReplyAction = useCallback(
    (messageId: string) => {
      clearReplyHoverTimeout();
      setHoveredMessageId(messageId);
    },
    [clearReplyHoverTimeout]
  );

  const hideReplyAction = useCallback(() => {
    clearReplyHoverTimeout();
    replyHoverTimeoutRef.current = window.setTimeout(() => {
      setHoveredMessageId("");
      replyHoverTimeoutRef.current = null;
    }, 140);
  }, [clearReplyHoverTimeout]);

  useEffect(() => {
    return () => {
      clearReplyHoverTimeout();
    };
  }, [clearReplyHoverTimeout]);

  const canEditSupplierMessage = useCallback(
    (message: TicketMessage) => {
      if (
        message.senderType !== "supplier" ||
        message.senderProfileId !== supplierProfileId ||
        message.messageType !== "text" ||
        message.transport === "email"
      ) {
        return false;
      }

      const now = currentTimeMs ?? Date.now();
      return now - new Date(message.createdAt).getTime() <= 20 * 60 * 1000;
    },
    [currentTimeMs, supplierProfileId]
  );

  const startEditingMessage = useCallback((message: TicketMessage) => {
    setEditTarget({
      messageId: message.id,
      originalText: message.displayContent,
    });
    setReplyTarget(null);
    setSelectedFiles([]);
    setAttachmentName("");
    setReplyText(message.displayContent);
    composerTextareaRef.current?.focus();
  }, []);

  const cancelEditingMessage = useCallback(() => {
    setEditTarget(null);
    setReplyText("");
  }, []);

  const selectedManagerName =
    (selectedActiveRequest?.createdByManagerId
      ? managerNameById[selectedActiveRequest.createdByManagerId]
      : undefined) ??
    selectedTicket?.assignedManagerName ??
    "Менеджер";
  const supplierCompanyName = formatSupplierCompanyName(supplierId, supplierName);
  const resolvedSupplierEmployeeName =
    sanitizeSupplierDisplaySegment(supplierEmployeeName) || "Поставщик";
  const supplierHeaderTitle =
    resolvedSupplierEmployeeName !== supplierCompanyName
      ? `${supplierCompanyName} / ${resolvedSupplierEmployeeName}`
      : supplierCompanyName;
  const supplierProfileSubtitle =
    resolvedSupplierEmployeeName !== supplierCompanyName
      ? `${resolvedSupplierEmployeeName} • ${supplierStatusLabels[supplierStatus]}`
      : supplierStatusLabels[supplierStatus];
  const supplierSupervisorPowerLabel = supplierSupervisorPowerEnabled
    ? "Активен"
    : "Отключён";
  const availableManagers = uniqueManagers.map((manager) => ({
    ...manager,
    status: managerStatuses[manager.id] ?? "offline",
  }));
  const firstOnlineManagerId =
    availableManagers.find((manager) => manager.status === "online")?.id ??
    availableManagers[0]?.id ??
    "";
  const onlineCompanySuppliers = Array.from(
    new Map(
      [
        {
          id: supplierProfileId,
          name: resolvedSupplierEmployeeName,
          status: supplierStatuses[supplierProfileId] ?? supplierStatus,
        },
        ...supplierRequests
          .filter(
            (request) =>
              request.supplierId === supplierId &&
              Boolean(request.assignedSupplierProfileId) &&
              Boolean(request.assignedSupplierProfileName)
          )
          .map((request) => ({
            id: request.assignedSupplierProfileId as string,
            name: request.assignedSupplierProfileName as string,
            status:
              supplierStatuses[request.assignedSupplierProfileId as string] ?? "offline",
          })),
      ]
        .filter((supplier) => supplier.id && supplier.name)
        .map((supplier) => [supplier.id, supplier])
    ).values()
  ).filter((supplier) => supplier.status === "online");
  const visibleSupplierMessages =
    selectedRequest ? getVisibleMessagesForTicket(selectedTicketRequests, ticketMessages) : [];
  visibleSupplierMessagesRef.current = visibleSupplierMessages;
  const supplierTimelineItems = selectedRequest
    ? buildSupplierTimelineItems(
        [...selectedTicketRequests].sort(
          (left, right) =>
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
        ),
        visibleSupplierMessages
      )
    : [];
  const normalizedChatSearchQuery = chatSearchQuery.trim().toLowerCase();
  const supplierChatSearchMatchIds =
    normalizedChatSearchQuery && selectedRequest
      ? supplierTimelineItems
          .filter((item) => {
            const searchableText =
              item.kind === "request"
                ? item.request.requestText
                : [
                    item.message.displayContent,
                    item.message.replyToContent,
                    item.message.senderName,
                  ]
                    .filter(Boolean)
                    .join(" ");

            return searchableText.toLowerCase().includes(normalizedChatSearchQuery);
          })
          .map((item) =>
            item.kind === "request" ? `request:${item.request.id}` : item.message.id
          )
      : [];
  const normalizedActiveChatSearchMatchIndex =
    supplierChatSearchMatchIds.length > 0
      ? ((activeChatSearchMatchIndex % supplierChatSearchMatchIds.length) +
          supplierChatSearchMatchIds.length) %
        supplierChatSearchMatchIds.length
      : -1;
  const currentSupplierChatSearchMatchId =
    normalizedActiveChatSearchMatchIndex >= 0
      ? supplierChatSearchMatchIds[normalizedActiveChatSearchMatchIndex]
      : null;
  const supplierChatSearchMatchIdSet = new Set(supplierChatSearchMatchIds);
  const resolvedTicketEmail =
    ticketContacts.find((contact) => contact.type === "email")?.value?.trim() ||
    selectedTicket?.canonicalEmail?.trim() ||
    selectedTicket?.clientEmail?.trim() ||
    selectedTicket?.currentUserEmail?.trim() ||
    selectedTicket?.superuserEmail?.trim() ||
    "";
  const filteredHistoryRequests = selectedTicketRequests.filter((request) => {
    if (requestHistoryFilter === "all") {
      return true;
    }

    const requestDate = new Date(request.createdAt);
    const nowDate = new Date();

    if (requestHistoryFilter === "custom") {
      if (!requestHistoryCustomDate) {
        return true;
      }

      const selectedDate = new Date(`${requestHistoryCustomDate}T00:00:00`);
      return isSameLocalDay(requestDate, selectedDate);
    }

    if (requestHistoryFilter === "day") {
      return isSameLocalDay(requestDate, nowDate);
    }

    const diffMs = nowDate.getTime() - requestDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (requestHistoryFilter === "week") {
      return diffDays <= 7;
    }

    if (requestHistoryFilter === "month") {
      return diffDays <= 31;
    }

    return true;
  });
  const lastClientMessageAtMs = visibleSupplierMessages.reduce<number | null>((latest, message) => {
    if (message.senderType !== "client") {
      return latest;
    }

    const createdAtMs = new Date(message.createdAt).getTime();

    if (!Number.isFinite(createdAtMs)) {
      return latest;
    }

    return latest === null ? createdAtMs : Math.max(latest, createdAtMs);
  }, null);
  const hasRecentClientMessage =
    typeof lastClientMessageAtMs === "number" &&
    (currentTimeMs ?? Date.now()) - lastClientMessageAtMs <= CLIENT_ON_SITE_ACTIVITY_TTL_MS;
  const clientIsOnSite =
    hasRecentClientMessage ||
    typeof currentPageViewAgeMs === "number" &&
    Number.isFinite(currentPageViewAgeMs) &&
    currentPageViewAgeMs >= 0 &&
    currentPageViewAgeMs <= CLIENT_ON_SITE_ACTIVITY_TTL_MS;
  const shouldShowClientOfflineHint =
    Boolean(selectedRequest) &&
    !isLoadingPageViews &&
    !pageViewsError &&
    !clientIsOnSite;
  const supplierRequestCards = buildSupplierRequestCards(
    supplierRequests,
    ticketMessagesByTicketId,
    pinnedRequestIds,
    ticketsById
  );

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setDeepLinkRequestId(params.get("request") ?? "");
    setDeepLinkTicketId(params.get("ticket") ?? "");
  }, []);

  useEffect(() => {
    if (!authReady || !supplierId || !supplierProfileId) {
      return;
    }

    const loadSupplierStatuses = async () => {
      try {
        const statuses = await fetchSupplierStatuses();
        setSupplierStatuses(statuses);
        const nextStatus = statuses[supplierProfileId] ?? "online";
        setSupplierStatus(nextStatus);
      } catch (error) {
        console.error("Ошибка загрузки статусов поставщиков:", error);
        setSupplierStatuses({});
        setSupplierStatus("online");
      }
    };

    void loadSupplierStatuses();

    const intervalId = window.setInterval(() => {
      void loadSupplierStatuses();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [authReady, supplierId, supplierProfileId]);

  useEffect(() => {
    if (!authReady || !supplierProfileId) {
      return;
    }

    const loadStatuses = async () => {
      try {
        const statuses = await fetchManagerStatuses();
        setManagerStatuses(statuses);
      } catch (error) {
        console.error("Ошибка загрузки статусов менеджеров:", error);
        setManagerStatuses({});
      }
    };

    void loadStatuses();

    const intervalId = window.setInterval(() => {
      void loadStatuses();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [authReady]);

  useEffect(() => {
    if (!authReady || !supplierProfileId) {
      return;
    }

    const syncPresence = async (status: ManagerPresence) => {
      try {
        await updateSupplierPresence(supplierProfileId, resolvedSupplierEmployeeName, status);
      } catch (error) {
        console.error("Ошибка синхронизации статуса поставщика:", error);
      }
    };

    void syncPresence(supplierStatus);

    if (supplierStatus === "offline") {
      return;
    }

    const intervalId = window.setInterval(() => {
      void syncPresence(supplierStatus);
    }, 15_000);

    return () => window.clearInterval(intervalId);
  }, [authReady, resolvedSupplierEmployeeName, supplierProfileId, supplierStatus]);

  const selectedRequestCard =
    selectedRequest
      ? supplierRequestCards.find((card) => card.request.ticketId === selectedRequest.ticketId) ??
        null
      : null;
  const supplierEmptyState =
    activeQueueTab === "new"
      ? {
          imageSrc: "/icons/vhodyshie.webp",
          title: "Новые обращения",
          description:
            "Все новые сообщения и запросы, которые ещё ждут обработки, отображаются в этой вкладке.",
        }
      : {
          imageSrc: "/icons/moi.webp",
          title: "Мои диалоги",
          description:
            "Во вкладке остаются только активные запросы, закреплённые за вами.",
        };
  const selectedClientLabel =
    selectedTicket?.tradePointName?.trim() ||
    selectedTicket?.clientName?.trim() ||
    selectedTicket?.clientId?.trim() ||
    selectedTicket?.title?.trim() ||
    `Ticket #${selectedActiveRequest?.ticketId ?? selectedRequest?.ticketId ?? ""}`;
  const now = Date.now();
  const supplierPanelStatus = selectedRequest
    ? buildSupplierPanelStatus({
        request: selectedActiveRequest ?? selectedRequest,
        ticketStatus: selectedTicket?.status,
        queueTab: selectedRequestCard?.queueTab,
      })
    : null;
  const supplierSla = selectedRequest
    ? buildSupplierSlaVisual({
        request: selectedActiveRequest ?? selectedRequest,
        now,
      })
    : null;
  const isSupplierDialogResolved =
    selectedTicket?.status === "resolved" || selectedRequestCard?.queueTab === "completed";
  const isSelectedRequestClaimedByAnotherSupplier =
    Boolean(
      selectedActiveRequest?.assignedSupplierProfileId &&
        supplierProfileId &&
        selectedActiveRequest.assignedSupplierProfileId !== supplierProfileId
    );
  const canSupplierTakeRequestInWork =
    Boolean(selectedActiveRequest) &&
    !isSupplierDialogResolved &&
    selectedRequestCard?.queueTab === "new" &&
    !isSelectedRequestClaimedByAnotherSupplier;
  const canSupplierReply =
    Boolean(selectedActiveRequest) &&
    !isSupplierDialogResolved &&
    !canSupplierTakeRequestInWork &&
    !isSelectedRequestClaimedByAnotherSupplier &&
    !selectedActiveRequest?.supplierSyncPaused;
  const isSupplierPausedByManager = Boolean(selectedActiveRequest?.supplierSyncPaused);
  const isSupplierWaitingForManager =
    selectedActiveRequest?.supplierSyncMode === "awaiting_manager";
  const canReturnSupplierRequestToQueue =
    Boolean(selectedActiveRequest) &&
    !isSupplierDialogResolved &&
    selectedRequestCard?.queueTab === "in_progress" &&
    selectedActiveRequest?.assignedSupplierProfileId === supplierProfileId;
  const canSupplierMarkResolved =
    !isResolvingTicket &&
    selectedTicket?.status !== "resolved" &&
    selectedRequestCard?.queueTab !== "completed";
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const activeTabRequests = supplierRequestCards.filter((card) => {
    if (card.queueTab !== activeQueueTab) {
      return false;
    }

    if (
      activeQueueTab === "in_progress" &&
      !isSupplierRequestMine(card.request, supplierProfileId)
    ) {
      return false;
    }

    if (!normalizedSearchQuery) {
      return true;
    }

    return [
      card.request.supplierName,
      ...card.requests.map((request) => request.requestText),
      card.managerName,
      card.request.ticketId,
      ticketsById[card.request.ticketId]?.canonicalEmail ?? "",
      ticketsById[card.request.ticketId]?.clientEmail ?? "",
      ticketsById[card.request.ticketId]?.currentUserEmail ?? "",
      ticketsById[card.request.ticketId]?.superuserEmail ?? "",
      ticketsById[card.request.ticketId]?.clientPhone ?? "",
      ticketsById[card.request.ticketId]?.currentUserPhone ?? "",
      ticketsById[card.request.ticketId]?.superuserPhone ?? "",
      ticketsById[card.request.ticketId]?.clientId ?? "",
      ticketsById[card.request.ticketId]?.clientName ?? "",
      ticketsById[card.request.ticketId]?.title ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearchQuery);
  });
  const queueCounts = supplierQueueTabs.reduce<Record<SupplierQueueTab, number>>(
    (accumulator, tab) => {
      accumulator[tab.id] = supplierRequestCards.filter(
        (card) =>
          card.queueTab === tab.id &&
          (tab.id !== "in_progress" ||
            isSupplierRequestMine(card.request, supplierProfileId))
      ).length;
      return accumulator;
    },
    {
      new: 0,
      in_progress: 0,
      completed: 0,
    }
  );
  const filteredQuickReplies = quickReplies.filter((phrase) =>
    phrase.toLowerCase().includes(quickReplySearch.trim().toLowerCase())
  );

  const readReplyMap = (ticketId: string) => {
    if (typeof window === "undefined") {
      return {} as Record<string, ReplyMeta>;
    }

    const rawValue = window.localStorage.getItem(supplierReplyMapStorageKey);

    if (!rawValue) {
      return {} as Record<string, ReplyMeta>;
    }

    try {
      const parsed = JSON.parse(rawValue) as Record<string, Record<string, ReplyMeta>>;
      return parsed[ticketId] ?? {};
    } catch {
      window.localStorage.removeItem(supplierReplyMapStorageKey);
      return {} as Record<string, ReplyMeta>;
    }
  };

  const writeReplyMap = (ticketId: string, nextReplyMap: Record<string, ReplyMeta>) => {
    if (typeof window === "undefined") {
      return;
    }

    const rawValue = window.localStorage.getItem(supplierReplyMapStorageKey);
    const parsed = rawValue
      ? (JSON.parse(rawValue) as Record<string, Record<string, ReplyMeta>>)
      : {};

    parsed[ticketId] = nextReplyMap;
    window.localStorage.setItem(supplierReplyMapStorageKey, JSON.stringify(parsed));
  };

  const focusReplyMessage = (messageId: string) => {
    const element = messageElementsRef.current[messageId];

    if (!element) {
      return;
    }

    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    setHighlightedReplyMessageId(messageId);

    if (highlightedReplyTimeoutRef.current) {
      window.clearTimeout(highlightedReplyTimeoutRef.current);
    }

    highlightedReplyTimeoutRef.current = window.setTimeout(() => {
      setHighlightedReplyMessageId("");
    }, 1800);
  };

  const scrollSupplierChatToBottom = (behavior: ScrollBehavior = "smooth") => {
    const viewport = messagesViewportRef.current;

    if (viewport) {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior,
      });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    }

    supplierIsNearBottomRef.current = true;
    setShowScrollToLatest(false);
    setPendingClientMessageCount(0);
  };

  const updateSupplierScrollState = () => {
    const viewport = messagesViewportRef.current;

    if (!viewport) {
      return;
    }

    const distanceToBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const isNearBottom = distanceToBottom < 96;

    supplierIsNearBottomRef.current = isNearBottom;

    if (isNearBottom) {
      setShowScrollToLatest(false);
      setPendingClientMessageCount(0);
      return;
    }

    setShowScrollToLatest(true);
  };

  const readSupplierStatus = (): ManagerPresence => {
    if (typeof window === "undefined") {
      return "online";
    }

    const rawValue = window.localStorage.getItem(supplierStatusStorageKey);

    if (
      rawValue === "online" ||
      rawValue === "break" ||
      rawValue === "offline"
    ) {
      return rawValue;
    }

    return "online";
  };

  const writeSupplierStatus = (status: ManagerPresence) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(supplierStatusStorageKey, status);
  };

  const readSupplierSupervisorPower = () => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.localStorage.getItem(supplierSupervisorPowerStorageKey) !== "0";
  };

  const writeSupplierSupervisorPower = (enabled: boolean) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      supplierSupervisorPowerStorageKey,
      enabled ? "1" : "0"
    );
  };

  const readPinnedRequestIds = () => {
    if (typeof window === "undefined") {
      return [];
    }

    const rawValue = window.localStorage.getItem(supplierPinnedRequestsStorageKey);

    if (!rawValue) {
      return [];
    }

    try {
      const parsedValue = JSON.parse(rawValue) as unknown;

      return Array.isArray(parsedValue)
        ? parsedValue.filter((value): value is string => typeof value === "string")
        : [];
    } catch {
      window.localStorage.removeItem(supplierPinnedRequestsStorageKey);
      return [];
    }
  };

  const writePinnedRequestIds = (nextPinnedRequestIds: string[]) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      supplierPinnedRequestsStorageKey,
      JSON.stringify(nextPinnedRequestIds)
    );
  };

  const fetchSupplierRequests = async (): Promise<SupplierRequest[]> => {
    const response = await fetch(
      apiUrl(
        `/supplier-requests?supplierName=${encodeURIComponent(
          supplierName
        )}&supplierId=${encodeURIComponent(supplierId)}`
      ),
      {
        cache: "no-store",
      }
    );

    if (response.ok) {
      return response.json();
    }

    const ticketsResponse = await fetch(
      apiUrl(
        `/tickets?viewerType=supplier&viewerId=${encodeURIComponent(supplierId)}`
      ),
      {
        cache: "no-store",
      }
    );

    if (!ticketsResponse.ok) {
      throw new Error("Не удалось загрузить запросы поставщику");
    }

    const tickets = (await ticketsResponse.json()) as Ticket[];
    const supplierRequestsByTicket = await Promise.all(
      tickets.map(async (ticket) => {
        const ticketRequestsResponse = await fetch(
          apiUrl(
            `/tickets/${ticket.id}/supplier-requests?supplierId=${encodeURIComponent(
              supplierId
            )}`
          ),
          {
            cache: "no-store",
          }
        );

        if (!ticketRequestsResponse.ok) {
          return [];
        }

        const ticketRequests =
          (await ticketRequestsResponse.json()) as SupplierRequest[];

        return ticketRequests.filter(
          (request) =>
            (request.supplierName === supplierName || request.supplierId === supplierId) &&
            (!request.assignedSupplierProfileId ||
              request.assignedSupplierProfileId === supplierProfileId)
        );
      })
    );

    return supplierRequestsByTicket
      .flat()
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
  };

  const showDesktopNotification = async (
    title: string,
    body: string,
    options?: {
      tag?: string;
      ticketId?: string;
      requestId?: string | null;
      metaLabel?: string | null;
      primaryLabel?: string;
      secondaryLabel?: string;
      avatarEmoji?: string | null;
      avatarColor?: string | null;
      tone?: "blue" | "amber";
    }
  ) => {
    const targetUrl = options?.requestId
      ? `/supplier?request=${options.requestId}`
      : options?.ticketId
        ? `/supplier?ticket=${options.ticketId}`
        : "/supplier";

    if (isDesktopShell()) {
      if (!shouldShowDesktopBackgroundNotification()) {
        return;
      }

      await showDesktopShellNotification({
        title,
        body,
        url: targetUrl,
        metaLabel: options?.metaLabel ?? null,
        primaryLabel: options?.primaryLabel,
        secondaryLabel: options?.secondaryLabel,
        avatarEmoji: options?.avatarEmoji ?? null,
        avatarColor: options?.avatarColor ?? null,
        tone: options?.tone ?? "blue",
      });
      return;
    }

    if (typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    if (Notification.permission !== "granted") {
      return;
    }

    if ("serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        await registration.showNotification(title, {
          body,
          icon: "/pwa/icon-192.svg",
          badge: "/pwa/badge.svg",
          tag: `supplier-ui-${options?.tag ?? title}`,
          data: {
            url: targetUrl,
          },
        });
        return;
      } catch (error) {
        console.error("Не удалось показать service-worker уведомление:", error);
      }
    }

    new Notification(title, { body });
  };

  const fetchSupplierNotificationCandidates = async (): Promise<
    SupplierNotificationCandidate[]
  > => {
    if (!supplierProfileId) {
      return [];
    }

    const response = await fetch(
      apiUrl(
        `/notifications/supplier-candidates?profileId=${encodeURIComponent(
          supplierProfileId
        )}`
      )
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить кандидатов для уведомлений поставщика");
    }

    const payload = (await response.json()) as { items?: SupplierNotificationCandidate[] };
    return Array.isArray(payload.items) ? payload.items : [];
  };

  const refreshNotificationCandidates = useCallback(async () => {
    if (!supplierSupervisorPowerEnabled) {
      setNotificationCandidates([]);
      return;
    }

    try {
      const candidates = await fetchSupplierNotificationCandidates();
      setNotificationCandidates(candidates);
    } catch (error) {
      console.error("Ошибка загрузки кандидатов для уведомлений поставщика:", error);
    }
  }, [supplierProfileId, supplierSupervisorPowerEnabled]);

  const fetchTicketMessages = async (ticketId: string): Promise<TicketMessage[]> => {
    const response = await fetch(
      apiUrl(
        `/tickets/${ticketId}/messages?viewerType=supplier&viewerId=${encodeURIComponent(
          supplierId
        )}&markAsRead=true`
      ),
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить сообщения тикета");
    }

    const data = (await response.json()) as TicketMessageApi[];
    return data.map(formatTicketMessage);
  };

  const fetchTicketContacts = async (ticketId: string): Promise<ChatContactItem[]> => {
    const response = await fetch(
      apiUrl(
        `/tickets/${ticketId}/contacts?viewerType=supplier&viewerId=${encodeURIComponent(
          supplierId
        )}`
      )
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить контакты");
    }

    const payload = (await response.json()) as ApiTicketContactsResponse;
    return Array.isArray(payload.items) ? payload.items : [];
  };

  const fetchTicketPageViews = async (
    ticketId: string
  ): Promise<ApiTicketPageViewsResponse> => {
    const response = await fetch(
      apiUrl(
        `/tickets/${ticketId}/page-views?viewerType=supplier&viewerId=${encodeURIComponent(
          supplierId
        )}`
      )
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить историю страниц");
    }

    return (await response.json()) as ApiTicketPageViewsResponse;
  };

  const syncSupplierRequests = (requests: SupplierRequest[]) => {
    setSupplierRequests((currentRequests) =>
      areRequestsEqual(currentRequests, requests) ? currentRequests : requests
    );
  };

  const updateSupplierRequestLocally = useCallback((nextRequest: SupplierRequest) => {
    setSupplierRequests((currentRequests) =>
      currentRequests.map((request) =>
        request.id === nextRequest.id ? { ...request, ...nextRequest } : request
      )
    );
  }, []);

  useEffect(() => {
    const session = readAuthSession();

    if (!session) {
      router.replace("/login");
      return;
    }

    if (session.role !== "supplier_supervisor") {
      router.replace(getHomePathForRole(session.role));
      return;
    }

    if (!session.supplierId) {
      clearAuthSession();
      router.replace("/login");
      return;
    }

    const resolvedSupplierId = session.supplierId;
    const resolvedSupplierCompanyName = formatSupplierCompanyName(
      resolvedSupplierId,
      session.companyName?.trim() ||
        session.supplierName ||
        session.fullName ||
        "Поставщик"
    );
    const resolvedSupplierEmployeeName =
      session.fullName?.trim() ||
      resolvedSupplierCompanyName;

    setSupplierId(resolvedSupplierId);
    setSupplierProfileId(session.userId ?? resolvedSupplierId);
    setSupplierName(resolvedSupplierCompanyName);
    setSupplierEmployeeName(resolvedSupplierEmployeeName);
    setSupplierSupervisorPowerEnabled(readSupplierSupervisorPower());
    writeSupplierStatus("online");
    setAuthReady(true);
    setSupplierStatus("online");
    setPinnedRequestIds(readPinnedRequestIds());
  }, [router]);

  useEffect(() => {
    if (!isSupplierMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!supplierMenuRef.current) {
        return;
      }

      if (!supplierMenuRef.current.contains(event.target as Node)) {
        setIsSupplierMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isSupplierMenuOpen]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    const loadSupplierRequests = async () => {
      setIsLoadingRequests(true);
      setRequestsError("");

      try {
        const data = await fetchSupplierRequests();
        const ticketsMap = await fetchTicketsMap(supplierId);
        const messagesMap = await fetchMessagesMapForRequests(data, supplierId);
        syncSupplierRequests(data);
        setTicketsById(ticketsMap);
        setTicketMessagesByTicketId((currentMap) =>
          areMessageMapsEqual(currentMap, messagesMap) ? currentMap : messagesMap
        );
      } catch (error) {
        console.error("Ошибка загрузки supplier requests:", error);
        setRequestsError("Не удалось загрузить запросы поставщику");
      } finally {
        setIsLoadingRequests(false);
      }
    };

    void loadSupplierRequests();
  }, [authReady, supplierId, supplierProfileId]);

  useEffect(() => {
    if (!authReady || !supplierId || !supplierProfileId) {
      return;
    }

    if (!selectedRequest) {
      setTicketMessages([]);
      setReplyText("");
      setReplyError("");
      setAttachmentName("");
      setSelectedFiles([]);
      return;
    }

    const loadMessages = async () => {
      setIsLoadingMessages(true);
      setMessagesError("");

      try {
        const data = await fetchTicketMessages(selectedRequest.ticketId);
        setTicketMessages((currentMessages) =>
          areMessagesEqual(currentMessages, data) ? currentMessages : data
        );
        setTicketMessagesByTicketId((currentMap) => {
          const nextMap = {
            ...currentMap,
            [selectedRequest.ticketId]: data,
          };

          return areMessageMapsEqual(currentMap, nextMap) ? currentMap : nextMap;
        });
      } catch (error) {
        console.error("Ошибка загрузки контекста тикета:", error);
        setMessagesError("Не удалось загрузить сообщения тикета");
      } finally {
        setIsLoadingMessages(false);
      }
    };

    void loadMessages();
  }, [authReady, selectedRequest]);

  useEffect(() => {
    if (!authReady || !selectedRequest?.ticketId) {
      setTicketContacts([]);
      setContactsError("");
      return;
    }

    const loadContacts = async () => {
      setIsLoadingContacts(true);
      setContactsError("");

      try {
        const contacts = await fetchTicketContacts(selectedRequest.ticketId);
        setTicketContacts(contacts);
      } catch (error) {
        console.error("Ошибка загрузки контактов:", error);
        setContactsError("Не удалось загрузить контакты");
      } finally {
        setIsLoadingContacts(false);
      }
    };

    void loadContacts();
  }, [authReady, selectedRequest?.ticketId]);

  useEffect(() => {
    if (!authReady || !selectedRequest?.ticketId) {
      setTicketPageViews([]);
      setCurrentPageView(null);
      setPageViewsError("");
      return;
    }

    const loadPageViews = async () => {
      setIsLoadingPageViews(true);
      setPageViewsError("");

      try {
        const payload = await fetchTicketPageViews(selectedRequest.ticketId);
        setCurrentPageView(payload.current ?? null);
        setTicketPageViews(Array.isArray(payload.items) ? payload.items : []);
      } catch (error) {
        console.error("Ошибка загрузки истории страниц:", error);
        setPageViewsError("Не удалось загрузить страницы клиента");
      } finally {
        setIsLoadingPageViews(false);
      }
    };

    void loadPageViews();
  }, [authReady, selectedRequest?.ticketId]);

  useEffect(() => {
    setAttachmentName("");
    setSelectedFiles([]);
    setChatSearchQuery("");
    setActiveChatSearchMatchIndex(0);
  }, [selectedRequestId]);

  useEffect(() => {
    if (!selectedRequest?.ticketId) {
      setReplyMap({});
      setReplyTarget(null);
      setChatSearchQuery("");
      setActiveChatSearchMatchIndex(0);
      return;
    }

    setReplyMap(readReplyMap(selectedRequest.ticketId));
    setReplyTarget(null);
    setChatSearchQuery("");
    setActiveChatSearchMatchIndex(0);
    setHoveredMessageId("");
    setHighlightedReplyMessageId("");
  }, [selectedRequest?.ticketId]);

  useEffect(() => {
    if (supplierChatSearchMatchIds.length === 0) {
      setActiveChatSearchMatchIndex(0);
      return;
    }

    if (activeChatSearchMatchIndex >= supplierChatSearchMatchIds.length) {
      setActiveChatSearchMatchIndex(0);
    }
  }, [activeChatSearchMatchIndex, supplierChatSearchMatchIds.length]);

  useEffect(() => {
    if (!currentSupplierChatSearchMatchId) {
      return;
    }

    const element = messageElementsRef.current[currentSupplierChatSearchMatchId];

    if (!element) {
      return;
    }

    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [currentSupplierChatSearchMatchId]);

  useEffect(() => {
    return () => {
      if (highlightedReplyTimeoutRef.current) {
        window.clearTimeout(highlightedReplyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const refreshSupplierWorkspace = async () => {
        try {
          const requests = await fetchSupplierRequests();
          const ticketsMap = await fetchTicketsMap(supplierId);
          const messagesMap = await fetchMessagesMapForRequests(requests, supplierId);
          const nextRequestCards = buildSupplierRequestCards(
            requests,
            messagesMap,
            pinnedRequestIds,
            ticketsMap
          );
          syncSupplierRequests(requests);
          setTicketsById(ticketsMap);
          setTicketMessagesByTicketId((currentMap) =>
            areMessageMapsEqual(currentMap, messagesMap) ? currentMap : messagesMap
          );

          const freshSelectedRequest =
            requests.find((request) => request.id === selectedRequestId) ??
            requests.find((request) => request.ticketId === selectedRequest?.ticketId) ??
            nextRequestCards[0]?.request ??
            null;

          if (!freshSelectedRequest) {
            setTicketMessages([]);
            return;
          }

          const messages = await fetchTicketMessages(freshSelectedRequest.ticketId);
          setTicketMessages((currentMessages) =>
            areMessagesEqual(currentMessages, messages) ? currentMessages : messages
          );
        } catch (pollingError) {
          console.error("Ошибка polling supplier page:", pollingError);
        }
      };

      void refreshSupplierWorkspace();
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [authReady, pinnedRequestIds, selectedRequest?.ticketId, selectedRequestId, supplierId, supplierProfileId]);

  useEffect(() => {
    if (!authReady || !supplierProfileId) {
      return;
    }

    if (!supplierSupervisorPowerEnabled) {
      setNotificationCandidates([]);
      return;
    }

    void refreshNotificationCandidates();

    const intervalId = window.setInterval(() => {
      void refreshNotificationCandidates();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [authReady, refreshNotificationCandidates, supplierProfileId, supplierSupervisorPowerEnabled]);

  useEffect(() => {
    if (supplierSupervisorPowerEnabled) {
      return;
    }

    setNotificationCandidates([]);
    lastNotificationAtRef.current = {};
    lastNotificationMessageIdRef.current = {};
  }, [supplierSupervisorPowerEnabled]);

  useEffect(() => {
    if (!authReady || !selectedRequest?.ticketId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchTicketPageViews(selectedRequest.ticketId)
        .then((payload) => {
          const nextCurrent = payload.current ?? null;
          const nextItems = Array.isArray(payload.items) ? payload.items : [];

          setCurrentPageView((currentValue) =>
            JSON.stringify(currentValue) === JSON.stringify(nextCurrent) ? currentValue : nextCurrent
          );
          setTicketPageViews((currentItems) =>
            JSON.stringify(currentItems) === JSON.stringify(nextItems) ? currentItems : nextItems
          );
          setPageViewsError("");
        })
        .catch((error) => {
          console.error("Ошибка live-обновления истории страниц:", error);
        });
    }, 3000);

    return () => window.clearInterval(intervalId);
  }, [authReady, selectedRequest?.ticketId]);

  useEffect(() => {
    setSelectedRequestId((currentSelectedRequestId) => {
      const currentSelectedRequest =
        supplierRequests.find((request) => request.id === currentSelectedRequestId) ?? null;

      if (
        currentSelectedRequestId &&
        supplierRequestCards.some(
          (card) =>
            card.request.id === currentSelectedRequestId ||
            card.request.ticketId === currentSelectedRequest?.ticketId
        )
      ) {
        return currentSelectedRequestId;
      }

      if (isChatPaneDismissed) {
        return "";
      }

      return supplierRequestCards[0]?.request.id ?? "";
    });
  }, [supplierRequestCards, isChatPaneDismissed]);

  useEffect(() => {
    if (deepLinkRequestId && supplierRequestCards.some((card) => card.request.id === deepLinkRequestId)) {
      setIsChatPaneDismissed(false);
      setSelectedRequestId(deepLinkRequestId);
      return;
    }

    if (deepLinkTicketId) {
      const linkedRequest = supplierRequestCards.find((card) => card.request.ticketId === deepLinkTicketId);
      if (linkedRequest) {
        setIsChatPaneDismissed(false);
        setSelectedRequestId(linkedRequest.request.id);
      }
    }
  }, [deepLinkRequestId, deepLinkTicketId, supplierRequestCards]);

  useEffect(() => {
    const currentRequestId = selectedRequestId;
    const currentMessageCount = supplierTimelineItems.length;
    const currentVisibleMessageCount = visibleSupplierMessages.length;
    const requestChanged = previousSelectedRequestIdRef.current !== currentRequestId;

    if (requestChanged) {
      previousSelectedRequestIdRef.current = currentRequestId;
      previousSupplierTimelineItemCountRef.current = currentMessageCount;
      previousVisibleMessageCountRef.current = currentVisibleMessageCount;
      supplierIsNearBottomRef.current = true;
      setShowScrollToLatest(false);
      setPendingClientMessageCount(0);

      if (currentRequestId) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollSupplierChatToBottom("auto");
          });
        });
      }

      return;
    }

    const previousMessageCount = previousSupplierTimelineItemCountRef.current;
    const previousVisibleMessageCount = previousVisibleMessageCountRef.current;

    if (currentMessageCount <= previousMessageCount) {
      previousSupplierTimelineItemCountRef.current = currentMessageCount;
      previousVisibleMessageCountRef.current = currentVisibleMessageCount;
      return;
    }

    const newlyArrivedMessages = visibleSupplierMessagesRef.current.slice(
      previousVisibleMessageCount,
      currentVisibleMessageCount
    );

    previousSupplierTimelineItemCountRef.current = currentMessageCount;
    previousVisibleMessageCountRef.current = currentVisibleMessageCount;

    if (supplierIsNearBottomRef.current) {
      requestAnimationFrame(() => {
        scrollSupplierChatToBottom("smooth");
      });
      return;
    }

    const newClientMessagesCount = newlyArrivedMessages.filter(
      (message) => message.senderType === "client"
    ).length;

    if (newClientMessagesCount > 0) {
      setPendingClientMessageCount((current) => current + newClientMessagesCount);
      setShowScrollToLatest(true);
    }
  }, [selectedRequestId, supplierTimelineItems.length, visibleSupplierMessages.length]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    setCurrentTimeMs(Date.now());

    const intervalId = window.setInterval(() => {
      setCurrentTimeMs(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [authReady]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNotificationNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  const visibleFloatingNotifications = notificationCandidates
    .filter((candidate) => {
      const hiddenUntil = dismissedNotificationUntil[candidate.notificationKey] ?? 0;
      if (hiddenUntil > notificationNow) {
        return false;
      }

      if (candidate.scopeStatus !== "claimed_by_other_recently") {
        return true;
      }

      const originalNotificationKey = candidate.requestId
        ? `supplier-request:${candidate.requestId}`
        : "";
      const originalHiddenUntil = originalNotificationKey
        ? dismissedNotificationUntil[originalNotificationKey] ?? 0
        : 0;

      return (
        Boolean(candidate.requestId) &&
        visibleNotificationRequestIdsRef.current.has(candidate.requestId as string) &&
        originalHiddenUntil <= notificationNow
      );
    })
    .slice(0, 3);

  useEffect(() => {
    visibleNotificationRequestIdsRef.current = new Set(
      visibleFloatingNotifications
        .map((candidate) => candidate.requestId)
        .filter((requestId): requestId is string => Boolean(requestId))
    );
  }, [visibleFloatingNotifications]);

  const dismissFloatingNotification = (notificationKey: string) => {
    setDismissedNotificationUntil((current) => ({
      ...current,
      [notificationKey]: Date.now() + REPEATED_NOTIFICATION_INTERVAL_MS,
    }));
  };

  const handlePrimaryFloatingNotification = (notificationKey: string) => {
    const candidate = notificationCandidates.find((item) => item.notificationKey === notificationKey);

    if (!candidate) {
      return;
    }

    if (candidate.requestId) {
      setSelectedRequestId(candidate.requestId);
      setActiveQueueTab(
        candidate.scopeStatus === "owned_active" ? "in_progress" : "new"
      );
    }

    dismissFloatingNotification(notificationKey);
  };

  useEffect(() => {
    if (!authReady || typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Не удалось зарегистрировать service worker:", error);
      });
    }
  }, [authReady]);

  useEffect(() => {
    if (!authReady || typeof window === "undefined") {
      return;
    }

    const activeCandidateIds = new Set(notificationCandidates.map((candidate) => candidate.notificationKey));

    Object.keys(lastNotificationAtRef.current).forEach((candidateId) => {
      if (!activeCandidateIds.has(candidateId)) {
        delete lastNotificationAtRef.current[candidateId];
        delete lastNotificationMessageIdRef.current[candidateId];
      }
    });

    if (!supplierSupervisorPowerEnabled) {
      return;
    }

    notificationCandidates.forEach((candidate) => {
      const isClaimedByOther = candidate.scopeStatus === "claimed_by_other_recently";
      const originalNotificationKey = candidate.requestId
        ? `supplier-request:${candidate.requestId}`
        : "";
      const originalHiddenUntil = originalNotificationKey
        ? dismissedNotificationUntil[originalNotificationKey] ?? 0
        : 0;

      if (
        isClaimedByOther &&
        (!candidate.requestId ||
          !visibleNotificationRequestIdsRef.current.has(candidate.requestId) ||
          originalHiddenUntil > notificationNow)
      ) {
        return;
      }

      const notificationTitle =
        isClaimedByOther
          ? "Запрос уже взят в работу"
          : candidate.kind === "request"
          ? `Новый запрос: ${candidate.title || "поставщик"}`
          : `Менеджер: ${candidate.title || "диалог"}`;
      const notificationBody =
        candidate.messageText.length > 80
          ? `${candidate.messageText.slice(0, 80)}...`
          : candidate.messageText;
      const notificationMeta =
        candidate.scopeStatus === "missed_unclaimed"
          ? "Пропущенный запрос более 10 минут"
          : candidate.scopeStatus === "owned_active"
            ? candidate.kind === "request"
              ? "Новый supplier request"
              : "Новое сообщение в вашем диалоге"
            : candidate.waitSeconds > 0
              ? `Ожидание ${Math.floor(candidate.waitSeconds / 60)} мин ${candidate.waitSeconds % 60} сек`
              : null;
      const notificationPrimaryLabel =
        isClaimedByOther
          ? "Открыть"
          : candidate.scopeStatus === "new_unclaimed" ||
              candidate.scopeStatus === "missed_unclaimed"
            ? "Взять в работу"
            : "Ответить";
      const lastNotificationAt = lastNotificationAtRef.current[candidate.notificationKey] ?? 0;
      const lastMessageId = lastNotificationMessageIdRef.current[candidate.notificationKey];
      const shouldNotify =
        lastMessageId !== candidate.messageId ||
        (!isClaimedByOther &&
          Date.now() - lastNotificationAt >= REPEATED_NOTIFICATION_INTERVAL_MS);

      if (!shouldNotify) {
        return;
      }

      lastNotificationAtRef.current[candidate.notificationKey] = Date.now();
      lastNotificationMessageIdRef.current[candidate.notificationKey] = candidate.messageId;
      playNotificationSound();

      void showDesktopNotification(notificationTitle, notificationBody, {
        tag: candidate.notificationKey,
        ticketId: candidate.ticketId,
        requestId: candidate.requestId,
        metaLabel: notificationMeta,
        primaryLabel: notificationPrimaryLabel,
        secondaryLabel: "Позже",
        avatarEmoji: candidate.avatarEmoji,
        avatarColor: candidate.avatarColor,
        tone: isClaimedByOther ? "amber" : "blue",
      });
    });
  }, [
    dismissedNotificationUntil,
    notificationCandidates,
    notificationNow,
    authReady,
    supplierSupervisorPowerEnabled,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (!defaultDocumentTitleRef.current) {
      defaultDocumentTitleRef.current = document.title;
    }

    if (titleFlashIntervalRef.current) {
      window.clearInterval(titleFlashIntervalRef.current);
      titleFlashIntervalRef.current = null;
    }

    const actionableNotifications = notificationCandidates.filter(
      (candidate) => candidate.scopeStatus !== "claimed_by_other_recently"
    );

    if (!supplierSupervisorPowerEnabled || actionableNotifications.length === 0) {
      document.title = defaultDocumentTitleRef.current;
      return;
    }

    let showAlertTitle = true;
    const alertTitle = `(${actionableNotifications.length}) Новый запрос • TouchSpace`;
    document.title = alertTitle;

    titleFlashIntervalRef.current = window.setInterval(() => {
      document.title = showAlertTitle ? alertTitle : defaultDocumentTitleRef.current;
      showAlertTitle = !showAlertTitle;
    }, 1000);

    return () => {
      if (titleFlashIntervalRef.current) {
        window.clearInterval(titleFlashIntervalRef.current);
        titleFlashIntervalRef.current = null;
      }
      document.title = defaultDocumentTitleRef.current;
    };
  }, [notificationCandidates, supplierSupervisorPowerEnabled]);

  useEffect(() => {
    setEditTarget(null);
    setHoveredEditMessageId("");
  }, [selectedRequestId]);

  useEffect(() => {
    if (!quickRepliesRef.current || (!showQuickReplies && !showEmojiPicker)) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!quickRepliesRef.current?.contains(event.target as Node)) {
        setShowQuickReplies(false);
        setShowEmojiPicker(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [showQuickReplies, showEmojiPicker]);

  useEffect(() => {
    if (!composerTextareaRef.current) {
      return;
    }

    composerTextareaRef.current.style.height = "0px";
    composerTextareaRef.current.style.height = `${Math.min(
      composerTextareaRef.current.scrollHeight,
      132
    )}px`;
  }, [replyText]);

  useEffect(() => {
    setEmailRecipient(resolvedTicketEmail);
  }, [resolvedTicketEmail, selectedRequestId]);

  useEffect(() => {
    if (!emailRecipient.trim() && resolvedTicketEmail) {
      setEmailRecipient(resolvedTicketEmail);
    }
  }, [resolvedTicketEmail, emailRecipient]);

  const handleLogout = () => {
    const session = readAuthSession();

    void logoutServerSession(session).finally(() => {
      clearAuthSession();
      router.replace("/login");
    });
  };

  const handleChangeSupplierStatus = (status: ManagerPresence) => {
    setSupplierStatus(status);
    writeSupplierStatus(status);
    setIsSupplierMenuOpen(false);
  };

  const handleToggleSupplierSupervisorPower = () => {
    setSupplierSupervisorPowerEnabled((prev) => {
      const nextValue = !prev;
      writeSupplierSupervisorPower(nextValue);
      return nextValue;
    });
  };

  const handleTogglePinned = async () => {
    if (!selectedRequest || isTogglingPinned) {
      return;
    }

    setIsTogglingPinned(true);
    setPinError("");

    try {
      setPinnedRequestIds((currentPinnedRequestIds) => {
        const ticketId = selectedRequest.ticketId;
        const isPinned = currentPinnedRequestIds.includes(ticketId);

        if (!isPinned && currentPinnedRequestIds.length >= 3) {
          throw new Error("Можно закрепить максимум 3 чата");
        }

        const nextPinnedRequestIds = isPinned
          ? currentPinnedRequestIds.filter((requestId) => requestId !== ticketId)
          : [ticketId, ...currentPinnedRequestIds];

        writePinnedRequestIds(nextPinnedRequestIds);
        return nextPinnedRequestIds;
      });
    } catch (error) {
      console.error("Ошибка обновления закрепления:", error);
      setPinError(
        error instanceof Error ? error.message : "Не удалось обновить закрепление"
      );
    } finally {
      setIsTogglingPinned(false);
    }
  };

  const handleInviteManager = async () => {
    if (!selectedRequest) {
      return;
    }

    const manager = availableManagers.find(
      (availableManager) => availableManager.id === selectedInvitedManagerId
    );

    if (!manager || manager.status !== "online") {
      setInviteManagerError("Выберите менеджера со статусом «В сети»");
      return;
    }

    setIsInvitingManager(true);
    setInviteManagerError("");

    try {
      const response = await fetch(
        apiUrl(`/tickets/${selectedRequest.ticketId}/invite-manager`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            managerId: manager.id,
            managerName: manager.name,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Не удалось пригласить менеджера");
      }

      const updatedTicket = (await response.json()) as Ticket;
      setTicketsById((current) => ({
        ...current,
        [updatedTicket.id]: updatedTicket,
      }));
      setIsInviteModalOpen(false);
    } catch (error) {
      console.error("Ошибка приглашения менеджера:", error);
      setInviteManagerError("Не удалось пригласить менеджера");
    } finally {
      setIsInvitingManager(false);
    }
  };

  const handleTransferDialog = async () => {
    if (!selectedRequest) {
      return;
    }

    const manager = availableManagers.find(
      (availableManager) => availableManager.id === selectedTransferManagerId
    );

    if (!manager || manager.status !== "online") {
      setTransferDialogError("Выберите менеджера со статусом «В сети»");
      return;
    }

    setIsTransferringDialog(true);
    setTransferDialogError("");

    try {
      const response = await fetch(
        apiUrl(`/tickets/${selectedRequest.ticketId}/assign-manager`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            managerId: manager.id,
            managerName: manager.name,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Не удалось передать диалог");
      }

      const updatedTicket = (await response.json()) as Ticket;
      setTicketsById((current) => ({
        ...current,
        [updatedTicket.id]: updatedTicket,
      }));
      setIsTransferModalOpen(false);
    } catch (error) {
      console.error("Ошибка передачи диалога:", error);
      setTransferDialogError("Не удалось передать диалог");
    } finally {
      setIsTransferringDialog(false);
    }
  };

  const handleResolveTicket = async () => {
    if (!selectedActiveRequest || !canSupplierMarkResolved) {
      return;
    }

    setIsResolvingTicket(true);

    try {
      const response = await fetch(apiUrl(`/supplier-requests/${selectedActiveRequest.id}/status`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "closed",
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось отметить диалог как решённый");
      }

      const [updatedRequests, updatedTicketsMap, refreshedMessages] = await Promise.all([
        fetchSupplierRequests(),
        fetchTicketsMap(supplierId),
        fetchTicketMessages(selectedActiveRequest.ticketId),
      ]);

      syncSupplierRequests(updatedRequests);
      setTicketsById((current) => ({
        ...current,
        [selectedActiveRequest.ticketId]:
          updatedTicketsMap[selectedActiveRequest.ticketId] ?? current[selectedActiveRequest.ticketId],
      }));
      setTicketMessages(refreshedMessages);
      setTicketMessagesByTicketId((prev) => ({
        ...prev,
        [selectedActiveRequest.ticketId]: refreshedMessages,
      }));
      setToast({
        message: "Диалог отмечен как решённый",
        tone: "success",
      });
      setActiveQueueTab("completed");
      setReplyText("");
      setAttachmentName("");
      setSelectedFiles([]);
      setShowQuickReplies(false);
      setShowEmojiPicker(false);
    } catch (error) {
      console.error("Ошибка завершения диалога:", error);
      setToast({
        message: "Не удалось отметить диалог как решённый",
        tone: "error",
      });
    } finally {
      setIsResolvingTicket(false);
    }
  };

  const handleTakeRequestInWork = async () => {
    if (!selectedActiveRequest || !supplierProfileId || !canSupplierTakeRequestInWork) {
      return;
    }

    setIsSendingReply(true);
    setReplyError("");

    try {
      const response = await fetch(apiUrl(`/supplier-requests/${selectedActiveRequest.id}/status`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "in_progress",
          assignedSupplierProfileId: supplierProfileId,
          assignedSupplierProfileName: resolvedSupplierEmployeeName,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось взять диалог в работу");
      }

      const [updatedRequests, updatedTicketsMap, refreshedMessages] = await Promise.all([
        fetchSupplierRequests(),
        fetchTicketsMap(supplierId),
        fetchTicketMessages(selectedActiveRequest.ticketId),
      ]);

      syncSupplierRequests(updatedRequests);
      setTicketsById(updatedTicketsMap);
      setTicketMessages(refreshedMessages);
      setTicketMessagesByTicketId((currentMap) => {
        const nextMap = {
          ...currentMap,
          [selectedActiveRequest.ticketId]: refreshedMessages,
        };

        return areMessageMapsEqual(currentMap, nextMap) ? currentMap : nextMap;
      });
      setActiveQueueTab("in_progress");
    } catch (error) {
      console.error("Ошибка взятия диалога в работу:", error);
      setReplyError(
        error instanceof Error ? error.message : "Не удалось взять диалог в работу"
      );
    } finally {
      setIsSendingReply(false);
    }
  };

  const handleReturnRequestToQueue = async () => {
    if (!selectedActiveRequest || !canReturnSupplierRequestToQueue) {
      return;
    }

    setIsSendingReply(true);
    setReplyError("");

    try {
      const response = await fetch(apiUrl(`/supplier-requests/${selectedActiveRequest.id}/status`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: "pending",
          clearAssignedSupplier: true,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось вернуть запрос в общую очередь");
      }

      const [updatedRequests, updatedTicketsMap, refreshedMessages] = await Promise.all([
        fetchSupplierRequests(),
        fetchTicketsMap(supplierId),
        fetchTicketMessages(selectedActiveRequest.ticketId),
      ]);

      syncSupplierRequests(updatedRequests);
      setTicketsById(updatedTicketsMap);
      setTicketMessages(refreshedMessages);
      setTicketMessagesByTicketId((currentMap) => ({
        ...currentMap,
        [selectedActiveRequest.ticketId]: refreshedMessages,
      }));
      setActiveQueueTab("new");
      setToast({
        message: "Запрос возвращён в общую очередь поставщика",
        tone: "info",
      });
    } catch (error) {
      console.error("Ошибка возврата запроса в очередь:", error);
      setReplyError(
        error instanceof Error
          ? error.message
          : "Не удалось вернуть запрос в общую очередь"
      );
    } finally {
      setIsSendingReply(false);
    }
  };

  const handleSendReply = async () => {
    const hasTextToSend = Boolean(replyText.trim());
    const hasAttachmentToSend = selectedFiles.length > 0;
    const isEmailMode = sendMode === "email";

    if (!supplierSupervisorPowerEnabled) {
      setReplyError(
        "Молния выключена. Вы можете читать диалоги, но отправка сообщений и уведомления отключены."
      );
      return;
    }

    if (
      !selectedRequest ||
      (!hasTextToSend && !hasAttachmentToSend) ||
      !canSupplierReply
    ) {
      return;
    }

    setIsSendingReply(true);
    setReplyError("");

    try {
      if (isEmailMode && hasAttachmentToSend) {
        setReplyError("В MVP email-режим пока поддерживает только текстовые сообщения");
        return;
      }

      if (isEmailMode && !emailRecipient.trim()) {
        setReplyError("Укажите email получателя");
        return;
      }

      if (editTarget) {
        if (!hasTextToSend) {
          return;
        }

        const response = await fetch(apiUrl(`/messages/${editTarget.messageId}`), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: replyText,
            senderType: "supplier",
            senderId: supplierProfileId,
          }),
        });

        if (!response.ok) {
          throw new Error("Не удалось сохранить изменения");
        }

        const data = await fetchTicketMessages(selectedRequest.ticketId);

        setTicketMessages(data);
        setTicketMessagesByTicketId((prev) => ({
          ...prev,
          [selectedRequest.ticketId]: data,
        }));
        setEditTarget(null);
        setReplyText("");
        setHoveredEditMessageId("");
        return;
      }

      const createdMessages: TicketMessage[] = [];

      if (hasTextToSend) {
        const response = await fetch(apiUrl("/messages"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ticketId: selectedRequest.ticketId,
            content: replyText,
            senderType: "supplier",
            transport: isEmailMode ? "email" : "chat",
            senderId: supplierProfileId,
            senderName: resolvedSupplierEmployeeName,
            replyToMessageId: replyTarget?.id,
            replyToContent: replyTarget ? getReplyPreviewContent(replyTarget) : undefined,
            toEmail: isEmailMode ? emailRecipient.trim() : undefined,
          }),
        });

        if (!response.ok) {
          throw new Error("Не удалось отправить ответ поставщика");
        }

        const createdMessage = (await response.json()) as TicketMessageApi;
        createdMessages.push(formatTicketMessage(createdMessage));
      }

      if (selectedFiles.length > 0) {
        const formData = new FormData();
        selectedFiles.forEach((file) => {
          formData.append("files", file);
        });
        formData.append("ticketId", selectedRequest.ticketId);
        formData.append("senderType", "supplier");
        formData.append("senderId", supplierProfileId);
        formData.append("senderName", resolvedSupplierEmployeeName);
        if (replyTarget?.id) {
          formData.append("replyToMessageId", replyTarget.id);
          formData.append("replyToContent", getReplyPreviewContent(replyTarget));
        }

        const attachmentResponse = await fetch(apiUrl("/messages/attachment"), {
          method: "POST",
          body: formData,
        });

        if (!attachmentResponse.ok) {
          throw new Error("Не удалось отправить вложение");
        }

        const createdAttachmentMessage = (await attachmentResponse.json()) as TicketMessageApi;
        createdMessages.push(formatTicketMessage(createdAttachmentMessage));
      }

      if (replyTarget && createdMessages.length > 0) {
        const nextReplyMap = {
          ...replyMap,
          [createdMessages[0].id]: {
            replyToId: replyTarget.id,
            replyToContent: getReplyPreviewContent(replyTarget),
          },
        };

        setReplyMap(nextReplyMap);
        writeReplyMap(selectedRequest.ticketId, nextReplyMap);
        setReplyTarget(null);
      }

      const data = await fetchTicketMessages(selectedRequest.ticketId);
      setTicketMessages(data);
      setTicketMessagesByTicketId((currentMap) => {
        const nextMap = {
          ...currentMap,
          [selectedRequest.ticketId]: data,
        };

        return areMessageMapsEqual(currentMap, nextMap) ? currentMap : nextMap;
      });
      setReplyText("");
      setAttachmentName("");
      setSelectedFiles([]);
      setHoveredMessageId("");
      if (isEmailMode) {
        setToast({
          message: `Email отправлен на ${emailRecipient.trim()}`,
          tone: "info",
        });
      }
      requestAnimationFrame(() => {
        scrollSupplierChatToBottom("smooth");
      });
    } catch (error) {
      console.error("Ошибка отправки ответа поставщика:", error);
      setReplyError(
        error instanceof Error
          ? error.message
          : "Не удалось отправить ответ поставщика"
      );
    } finally {
      setIsSendingReply(false);
    }
  };

  const handleResumeSupplierSync = async () => {
    if (!selectedActiveRequest) {
      return;
    }

    setIsResumingSupplierSync(true);
    setReplyError("");

    try {
      const response = await fetch(apiUrl(`/supplier-requests/${selectedActiveRequest.id}/sync`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "resume_request",
          actorType: "supplier",
          actorId: supplierProfileId,
          actorName: resolvedSupplierEmployeeName,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось запросить возврат в диалог");
      }

      const updatedRequest = (await response.json()) as SupplierRequest;
      updateSupplierRequestLocally(updatedRequest);

      const [updatedRequests, updatedTicketsMap, refreshedMessages] = await Promise.all([
        fetchSupplierRequests(),
        fetchTicketsMap(supplierId),
        fetchTicketMessages(selectedActiveRequest.ticketId),
      ]);

      syncSupplierRequests(updatedRequests);
      setTicketsById(updatedTicketsMap);
      setTicketMessages(refreshedMessages);
      setTicketMessagesByTicketId((currentMap) => ({
        ...currentMap,
        [selectedActiveRequest.ticketId]: refreshedMessages,
      }));
      setToast({
        message:
          updatedRequest.supplierSyncMode === "awaiting_manager"
            ? "Запрос отправлен менеджеру"
            : "Live-диалог снова доступен",
        tone: "info",
      });
    } catch (error) {
      console.error("Ошибка возобновления live-диалога:", error);
      setReplyError(
        error instanceof Error ? error.message : "Не удалось запросить возврат в диалог"
      );
    } finally {
      setIsResumingSupplierSync(false);
    }
  };

  const moveChatSearchMatch = (direction: 1 | -1) => {
    if (supplierChatSearchMatchIds.length === 0) {
      return;
    }

    setActiveChatSearchMatchIndex((current) =>
      (current + direction + supplierChatSearchMatchIds.length) %
      supplierChatSearchMatchIds.length
    );
  };

  const handleAddQuickReply = () => {
    setShowQuickReplies(false);
    setShowEmojiPicker(false);
    setNewQuickReplyText("");
    setIsQuickReplyModalOpen(true);
  };

  const handleSaveQuickReply = () => {
    const normalizedPhrase = newQuickReplyText.trim();

    if (!normalizedPhrase) {
      return;
    }

    setQuickReplies((currentReplies) => {
      const withoutDuplicate = currentReplies.filter(
        (phrase) => phrase.toLowerCase() !== normalizedPhrase.toLowerCase()
      );

      return [normalizedPhrase, ...withoutDuplicate];
    });

    setReplyText(normalizedPhrase);
    setShowQuickReplies(false);
    setQuickReplySearch("");
    setNewQuickReplyText("");
    setIsQuickReplyModalOpen(false);
  };

  if (!authReady) {
    return (
      <main className="min-h-screen bg-[#F4F6F8] flex items-center justify-center text-gray-500">
        Проверяем доступ...
      </main>
    );
  }

  return (
    <main
      className="h-screen overflow-hidden bg-[#F5F5F7]"
      style={{ fontFamily: appFontFamily }}
    >
      <div className="flex h-full min-w-0 overflow-hidden">
        <aside className="flex h-full w-[300px] shrink-0 flex-col border-r border-[#E5E5EA] bg-[#FBFBFD] px-4 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8E8E93]">
            TouchSpace
          </p>
          <h1 className="mt-2 text-[22px] font-semibold text-[#1E1E1E]">
            {supplierHeaderTitle}
          </h1>
          <p className="mt-1 text-[13px] text-[#8E8E93]">
            Очередь обращений
          </p>

          <div ref={supplierMenuRef} className="relative mt-4">
            <div className="rounded-[16px] border border-[#E9EAF0] bg-white px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
              <button
                onClick={() => setIsSupplierMenuOpen((prev) => !prev)}
                className="flex w-full items-center gap-2.5 transition hover:opacity-90"
              >
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEF6FF]">
                  <Image
                    src="/icons/menedger.svg"
                    alt="Поставщик"
                    width={16}
                    height={16}
                    className="h-4 w-4"
                    style={{
                      filter:
                        "brightness(0) saturate(100%) invert(38%) sepia(98%) saturate(2437%) hue-rotate(204deg) brightness(102%) contrast(101%)",
                    }}
                  />
                  <span
                    className={`absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${supplierStatusDots[supplierStatus]}`}
                  />
                </div>

                <div className="min-w-0 flex-1 text-left leading-none">
                  <p className="truncate text-[14px] font-semibold text-[#1E1E1E]">
                    {supplierCompanyName}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-[#8E8E93]">
                    {supplierProfileSubtitle}
                  </p>
                </div>

                <span className="shrink-0 text-[11px] text-[#AEAEB2]">▾</span>
              </button>

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#EEF0F4] pt-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8E8E93]">
                    Режим ответа
                  </p>
                  <p className="mt-1 text-[12px] text-[#6C6C70]">
                    {supplierSupervisorPowerEnabled
                      ? "Уведомления и отправка сообщений включены"
                      : "Только чтение без уведомлений"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleToggleSupplierSupervisorPower}
                  className={`relative inline-flex h-8 w-[62px] shrink-0 items-center rounded-full px-1 transition ${
                    supplierSupervisorPowerEnabled ? "bg-[#34C759]" : "bg-[#D1D1D6]"
                  }`}
                  aria-label="Переключить режим ответа управленца поставщика"
                  aria-pressed={supplierSupervisorPowerEnabled}
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full bg-white text-[14px] shadow-[0_4px_10px_rgba(15,23,42,0.16)] transition ${
                      supplierSupervisorPowerEnabled
                        ? "translate-x-[30px] text-[#F5C542]"
                        : "translate-x-0 text-[#9A9AA1]"
                    }`}
                  >
                    ⚡
                  </span>
                </button>
              </div>

              <p className="mt-2 text-[11px] font-medium text-[#8E8E93]">
                Молния: {supplierSupervisorPowerLabel}
              </p>
            </div>

            {isSupplierMenuOpen ? (
              <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-[210px] rounded-[18px] border border-[#E5E5EA] bg-white p-2 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                {(["online", "break", "offline"] as ManagerPresence[]).map((status) => (
                  <button
                    key={status}
                    onClick={() => handleChangeSupplierStatus(status)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                      supplierStatus === status ? "bg-[#F3F8FF]" : "hover:bg-[#F7F8FB]"
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${supplierStatusDots[status]}`} />
                    <p className="text-[13px] font-medium text-[#1E1E1E]">
                      {supplierStatusLabels[status]}
                    </p>
                  </button>
                ))}

                <div className="my-2 h-px bg-[#EEF0F4]" />

                <button
                  onClick={() => router.push("/supplier-supervisor/settings")}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-medium text-[#1E1E1E] transition hover:bg-[#F7F8FB]"
                >
                  <span>Настройки</span>
                  <span className="text-xs text-[#8E8E93]">→</span>
                </button>

                <div className="my-2 h-px bg-[#EEF0F4]" />

                <button
                  onClick={handleLogout}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[13px] font-medium text-[#FD6868] transition hover:bg-[#FFF4F4]"
                >
                  <span>Выйти</span>
                  <span className="text-xs">↗</span>
                </button>
              </div>
            ) : null}
          </div>

          <div className="mt-6 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="rounded-[12px] bg-[#F2F2F5] p-1">
              <div className="grid grid-cols-2 gap-1">
              {supplierQueueTabs.map((tab) => {
                const isActive = activeQueueTab === tab.id;
                const count = queueCounts[tab.id];

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveQueueTab(tab.id)}
                    className={`inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold transition ${
                      isActive
                        ? "bg-white text-[#1E1E1E] shadow-[0_2px_6px_rgba(15,23,42,0.06)]"
                        : "bg-transparent text-[#6C6C70] hover:text-[#1E1E1E]"
                    }`}
                  >
                    <span>{tab.label}</span>
                    {tab.id !== "completed" ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${
                          isActive ? tab.badgeClassName : "bg-white text-[#8E8E93]"
                        }`}
                      >
                        {count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
              </div>
            </div>

            <div>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none placeholder:text-[#8E8E93]"
                placeholder="Поиск по клиенту, диалогу или запросу..."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-[#6C6C70]">
              <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-[#1E1E1E]">
                Онлайн: {onlineCompanySuppliers.length}
              </span>
              {onlineCompanySuppliers.length > 0 ? (
                onlineCompanySuppliers.map((supplier) => (
                  <span
                    key={supplier.id}
                    className="inline-flex items-center gap-2 rounded-full bg-[#EEF6FF] px-3 py-1.5"
                  >
                    <span className="h-2 w-2 rounded-full bg-[#34C759]" />
                    <span>
                      {supplier.name}
                      {supplier.id === supplierProfileId ? " (Вы)" : ""}
                    </span>
                  </span>
                ))
              ) : (
                <span className="rounded-full bg-[#F2F2F7] px-3 py-1.5">
                  Нет поставщиков со статусом online
                </span>
              )}
            </div>

            {isLoadingRequests && (
              <p className="text-sm text-gray-500">Загружаем запросы...</p>
            )}

            {requestsError && (
              <p className="text-sm text-red-500">{requestsError}</p>
            )}

            {pinError && (
              <p className="text-sm text-red-500">{pinError}</p>
            )}

            {!isLoadingRequests &&
              !requestsError &&
              activeTabRequests.map((card) => (
                (() => {
                  const tone = getSupplierCardTone(card.request, card.queueTab);
                  const managerLabel =
                    card.ticket?.assignedManagerName?.trim() ||
                    card.ticket?.lastResolvedByManagerName?.trim() ||
                    (card.managerName !== "Не указан" ? card.managerName : "Не назначен");

                  return (
                  <DialogListCard
                  key={card.request.id}
                    active={selectedRequestId === card.request.id}
                    emphasized={
                      card.queueTab === "new" ||
                      Boolean(card.request.claimMissedAt || card.request.returnedToQueueAt)
                    }
                    onClick={() => {
                      setIsChatPaneDismissed(false);
                      setSelectedRequestId(card.request.id);
                    }}
                    title={getSupplierCardClientLabel(card.ticket, card.request)}
                    identityKey={
                      card.ticket?.clientId ||
                      card.ticket?.clientName ||
                      card.ticket?.title ||
                      card.request.ticketId
                    }
                    avatarColor={card.ticket?.avatarColor}
                    avatarEmoji={card.ticket?.avatarEmoji}
                    statusDotClassName={tone.dot}
                    preview={getSupplierCardPreview(card)}
                    managerLabel={managerLabel}
                    timeLabel={formatDialogActivityLabel(card.lastActivityAt)}
                    statusLabel={tone.label}
                    statusBadgeClassName={tone.pill}
                    pinned={card.pinned}
                  />
                  );
                })()
              ))}

            {!isLoadingRequests &&
              !requestsError &&
              supplierRequests.length > 0 &&
              activeTabRequests.length === 0 && (
                <div className="rounded-[22px] border border-dashed border-[#D8D8DE] bg-white/70 p-5 text-sm leading-6 text-[#8E8E93]">
                  {searchQuery.trim()
                    ? "Ничего не найдено по текущему запросу."
                    : "Нет диалогов."}
                </div>
              )}

            {!isLoadingRequests &&
              !requestsError &&
              supplierRequests.length === 0 && (
                <p className="text-sm text-gray-500">
                  Для этого поставщика пока нет назначенных запросов.
                </p>
              )}
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 overflow-hidden bg-[#F7F7FA]">
          {selectedRequest ? (
            <>
              <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#F7F7FA]">
                {!isDesktopShell() ? (
                  <IncomingAlertStack
                  items={visibleFloatingNotifications.map((candidate) => ({
                    id: candidate.notificationKey,
                    title:
                      candidate.tradePointName?.trim() ||
                      candidate.title ||
                      "Запрос поставщику",
                    subtitle:
                      candidate.scopeStatus === "claimed_by_other_recently"
                        ? candidate.assignedSupplierProfileName
                          ? `Уже ведёт ${candidate.assignedSupplierProfileName}`
                          : "Запрос уже забрал коллега"
                        : candidate.kind === "request"
                          ? "Новый запрос поставщику"
                          : "Новое сообщение от менеджера",
                    preview:
                      candidate.scopeStatus === "claimed_by_other_recently"
                        ? candidate.assignedSupplierProfileName
                          ? `Сейчас этот запрос ведёт ${candidate.assignedSupplierProfileName}`
                          : "Сейчас этот запрос ведёт другой сотрудник поставщика"
                        : candidate.messageText,
                    tone:
                      candidate.scopeStatus === "claimed_by_other_recently"
                        ? "amber"
                        : "blue",
                    avatarEmoji: candidate.avatarEmoji,
                    avatarColor: candidate.avatarColor,
                    metaLabel:
                      candidate.scopeStatus === "missed_unclaimed"
                        ? "Пропущенный запрос более 10 минут"
                        : candidate.scopeStatus === "owned_active"
                          ? "Новое сообщение в вашем запросе"
                          : candidate.waitSeconds > 0
                            ? `Ожидание ${Math.floor(candidate.waitSeconds / 60)} мин ${candidate.waitSeconds % 60} сек`
                            : null,
                    primaryLabel:
                      candidate.scopeStatus === "claimed_by_other_recently"
                        ? "Открыть"
                        : candidate.scopeStatus === "new_unclaimed" ||
                            candidate.scopeStatus === "missed_unclaimed"
                          ? "Взять в работу"
                          : "Ответить",
                    secondaryLabel: "Позже",
                  }))}
                  onClose={dismissFloatingNotification}
                  onSecondary={dismissFloatingNotification}
                  onPrimary={handlePrimaryFloatingNotification}
                  />
                ) : null}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[#E5E5EA] bg-white px-6 py-5">
                  <div className="min-w-0">
                    <p className="truncate text-[18px] font-semibold text-[#1E1E1E]">
                      {selectedClientLabel}
                    </p>
                    <div className="mt-1 max-w-[620px]">
                      <PageTrackingCard
                        current={currentPageView}
                        items={ticketPageViews}
                        isLoading={isLoadingPageViews}
                        error={pageViewsError}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-[12px] bg-[#F2F2F5] p-1.5">
                      <div className="relative">
                        <button
                          onClick={handleTogglePinned}
                          disabled={isTogglingPinned}
                          onMouseEnter={() => setHoveredHeaderAction("pin")}
                          onMouseLeave={() => setHoveredHeaderAction(null)}
                          className={`flex h-9 w-9 items-center justify-center rounded-[10px] transition duration-200 hover:bg-[#E5F0FF] ${
                            selectedRequestCard?.pinned ? "bg-[#595FFF]" : "bg-transparent"
                          }`}
                        >
                          <Image
                            src="/icons/zakrepit.svg"
                            alt="Закрепить"
                            width={18}
                            height={18}
                            className={`h-[18px] w-[18px] ${
                              selectedRequestCard?.pinned ? "brightness-0 invert" : "opacity-70"
                            }`}
                          />
                        </button>
                        {hoveredHeaderAction === "pin" ? (
                          <div className="absolute left-1/2 top-[calc(100%+8px)] z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                            {selectedRequestCard?.pinned ? "Открепить чат" : "Закрепить чат"}
                          </div>
                        ) : null}
                      </div>

                      <div className="relative">
                        <button
                          onClick={() => {
                            setSelectedInvitedManagerId(firstOnlineManagerId);
                            setInviteManagerError("");
                            setIsInviteModalOpen(true);
                          }}
                          onMouseEnter={() => setHoveredHeaderAction("invite")}
                          onMouseLeave={() => setHoveredHeaderAction(null)}
                          className="flex h-9 w-9 items-center justify-center rounded-[10px] transition duration-200 hover:bg-[#E5F0FF]"
                        >
                          <Image
                            src="/icons/dobavit.svg"
                            alt="Пригласить"
                            width={18}
                            height={18}
                            className="h-[18px] w-[18px] opacity-70"
                          />
                        </button>
                        {hoveredHeaderAction === "invite" ? (
                          <div className="absolute left-1/2 top-[calc(100%+8px)] z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                            Пригласить менеджера
                          </div>
                        ) : null}
                      </div>

                      <div className="relative">
                        <button
                          onClick={() => {
                            setSelectedTransferManagerId(firstOnlineManagerId);
                            setTransferDialogError("");
                            setIsTransferModalOpen(true);
                          }}
                          onMouseEnter={() => setHoveredHeaderAction("transfer")}
                          onMouseLeave={() => setHoveredHeaderAction(null)}
                          className="flex h-9 w-9 items-center justify-center rounded-[10px] transition duration-200 hover:bg-[#E5F0FF]"
                        >
                          <Image
                            src="/icons/priglasit.svg"
                            alt="Передать"
                            width={18}
                            height={18}
                            className="h-[18px] w-[18px] opacity-70"
                          />
                        </button>
                        {hoveredHeaderAction === "transfer" ? (
                          <div className="absolute left-1/2 top-[calc(100%+8px)] z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                            Передать
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="relative">
                      <button
                        onClick={handleResolveTicket}
                        disabled={isResolvingTicket || selectedTicket?.status === "resolved"}
                        onMouseEnter={() => setHoveredHeaderAction("resolve")}
                        onMouseLeave={() => setHoveredHeaderAction(null)}
                        className="flex items-center gap-2 rounded-[10px] bg-[#E9F7EF] px-4 py-2 text-sm font-semibold text-[#34C759] transition duration-200 hover:scale-[1.02] active:scale-95 disabled:cursor-default disabled:opacity-80"
                      >
                        <Image
                          src="/icons/reshen.svg"
                          alt="Решён"
                          width={16}
                          height={16}
                          className="h-4 w-4"
                          style={{
                            filter:
                              "brightness(0) saturate(100%) invert(58%) sepia(78%) saturate(2475%) hue-rotate(317deg) brightness(103%) contrast(98%)",
                          }}
                        />
                        <span>{isResolvingTicket ? "Сохраняем..." : "Решён"}</span>
                      </button>
                      {hoveredHeaderAction === "resolve" ? (
                        <div className="absolute right-0 top-[calc(100%+8px)] z-20 whitespace-nowrap rounded-lg bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                          Отметить как решённый
                        </div>
                      ) : null}
                    </div>

                    <div className="relative">
                      <button
                        onClick={() => {
                          setHoveredHeaderAction(null);
                          setIsChatPaneDismissed(true);
                          setSelectedRequestId("");
                          setReplyTarget(null);
                          setShowQuickReplies(false);
                          setShowEmojiPicker(false);
                          setReplyError("");
                        }}
                        onMouseEnter={() => setHoveredHeaderAction("close")}
                        onMouseLeave={() => setHoveredHeaderAction(null)}
                        className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[#E5E5EA] bg-white text-[#8E8E93] transition duration-200 hover:bg-[#F7F8FB] hover:text-[#1E1E1E]"
                      >
                        ✕
                      </button>
                      {hoveredHeaderAction === "close" ? (
                        <div className="absolute right-0 top-[calc(100%+8px)] z-20 whitespace-nowrap rounded-lg bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                          Свернуть
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div
                  ref={messagesViewportRef}
                  onScroll={updateSupplierScrollState}
                  className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
                >
                  <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4">
                    {isLoadingMessages && (
                      <p className="text-sm text-gray-500">Загружаем сообщения...</p>
                    )}

                    {messagesError && (
                      <p className="text-sm text-red-500">{messagesError}</p>
                    )}

                    {!isLoadingMessages &&
                      !messagesError &&
                      supplierTimelineItems.map((item, index) => {
                        const previousItem = supplierTimelineItems[index - 1];
                        const shouldShowDateSeparator =
                          !previousItem ||
                          getMessageDayKey(previousItem.createdAt) !==
                            getMessageDayKey(item.createdAt);

                        if (item.kind === "request") {
                          const { request } = item;
                          const searchMatchId = `request:${request.id}`;
                          const isSearchMatched =
                            supplierChatSearchMatchIdSet.has(searchMatchId);
                          const isCurrentSearchMatch =
                            currentSupplierChatSearchMatchId === searchMatchId;

                          return (
                            <div
                              key={item.id}
                              ref={(element) => {
                                messageElementsRef.current[searchMatchId] = element;
                              }}
                              className={`rounded-[26px] px-2 py-1 transition-all duration-500 ${
                                isCurrentSearchMatch
                                  ? "bg-[#FFF4D6] shadow-[0_10px_24px_rgba(255,193,7,0.18)]"
                                  : isSearchMatched
                                    ? "bg-[#FFF9EA]"
                                    : "bg-transparent"
                              }`}
                            >
                              {shouldShowDateSeparator && (
                                <div className="flex justify-center py-1">
                                  <div className="rounded-full bg-[#F2F2F7] px-4 py-1.5 text-xs font-medium text-[#8E8E93]">
                                    {formatMessageDayLabel(item.createdAt)}
                                  </div>
                                </div>
                              )}

                              <div className="flex justify-center py-2">
                                <div className="w-full max-w-[620px] rounded-[24px] border border-[#D7E6FF] bg-[linear-gradient(135deg,#F5F9FF_0%,#EEF6FF_100%)] px-5 py-4 shadow-[0_18px_40px_rgba(10,132,255,0.10)]">
                                  <div className="flex items-center justify-between gap-4">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0A84FF]">
                                      Запрос менеджера
                                    </p>
                                    <p className="shrink-0 text-[11px] font-medium text-[#7B8AA0]">
                                      {formatTimeLabel(request.createdAt)}
                                    </p>
                                  </div>
                                  <p className="mt-3 text-[15px] leading-6 text-[#1E1E1E]">
                                    {renderHighlightedText(
                                      request.requestText,
                                      chatSearchQuery
                                    )}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        const { message } = item;
                        const isSearchMatched = supplierChatSearchMatchIdSet.has(message.id);
                        const isCurrentSearchMatch =
                          currentSupplierChatSearchMatchId === message.id;
                        const authorLabel = getSupplierMessageAuthorLabel(message);

                        return (
                          <div
                            key={item.id}
                            ref={(element) => {
                              messageElementsRef.current[message.id] = element;
                            }}
                            className={`rounded-[26px] px-2 py-1 transition-all duration-500 ${
                              highlightedReplyMessageId === message.id
                                ? "bg-[#EAF3FF] shadow-[0_10px_24px_rgba(10,132,255,0.10)]"
                                : isCurrentSearchMatch
                                  ? "bg-[#FFF4D6] shadow-[0_10px_24px_rgba(255,193,7,0.18)]"
                                  : isSearchMatched
                                    ? "bg-[#FFF9EA]"
                                : "bg-transparent shadow-none"
                            }`}
                          >
                            {shouldShowDateSeparator && (
                              <div className="flex justify-center py-1">
                                <div className="rounded-full bg-[#F2F2F7] px-4 py-1.5 text-xs font-medium text-[#8E8E93]">
                                  {formatMessageDayLabel(message.createdAt)}
                                </div>
                              </div>
                            )}

                            {message.senderType === "system" ? (
                              <div className="flex justify-center py-2">
                                <div className="max-w-[620px] rounded-[18px] border border-[#E5E5EA] bg-[#F7F7FA] px-4 py-3 text-center text-sm leading-6 text-[#6C6C70] shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                                  {renderHighlightedText(
                                    message.displayContent,
                                    chatSearchQuery
                                  )}
                                </div>
                              </div>
                            ) : (
                            <div
                              className={`flex ${
                                message.senderType === "supplier"
                                  ? "justify-end"
                                  : "justify-start"
                              }`}
                            >
                              <div
                                className={`group relative inline-block w-fit max-w-[calc(88%+40px)] ${
                                  message.senderType === "supplier"
                                    ? "pl-10 -ml-10"
                                    : "pr-10 -mr-10"
                                }`}
                                onMouseEnter={() => showReplyAction(message.id)}
                                onMouseLeave={hideReplyAction}
                              >
                                <div
                                  className={`absolute top-2 z-10 flex flex-col gap-2 transition ${
                                    hoveredMessageId === message.id ||
                                    hoveredEditMessageId === message.id
                                      ? "opacity-100"
                                      : "pointer-events-none opacity-0"
                                  } ${message.senderType === "supplier" ? "left-0" : "right-0"}`}
                                >
                                  <button
                                    onClick={() => {
                                      setReplyTarget(message);
                                      composerTextareaRef.current?.focus();
                                    }}
                                    onMouseEnter={() => showReplyAction(message.id)}
                                    onMouseLeave={hideReplyAction}
                                    className="relative flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm text-[#8E8E93] shadow-sm transition hover:bg-[#F5F8FF] hover:text-[#0A84FF]"
                                    aria-label="Ответить"
                                  >
                                    <svg
                                      viewBox="0 0 20 20"
                                      fill="none"
                                      className="h-4 w-4"
                                      aria-hidden="true"
                                    >
                                      <path
                                        d="M8.25 5.5L4.5 9.25L8.25 13"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                      <path
                                        d="M5.25 9.25H11.25C13.8734 9.25 16 11.3766 16 14V14.5"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                    {hoveredMessageId === message.id ? (
                                      <span className="absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-[10px] border border-[#E5E5EA] bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                                        Ответить
                                      </span>
                                    ) : null}
                                  </button>
                                  {canEditSupplierMessage(message) ? (
                                    <button
                                      type="button"
                                      onClick={() => startEditingMessage(message)}
                                      onMouseEnter={() => setHoveredEditMessageId(message.id)}
                                      onMouseLeave={() => setHoveredEditMessageId("")}
                                      className="relative flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm text-[#8E8E93] shadow-sm transition hover:bg-[#FFF8EE] hover:text-[#C1812B]"
                                      aria-label="Редактировать"
                                    >
                                      <svg
                                        viewBox="0 0 20 20"
                                        fill="none"
                                        className="h-4 w-4"
                                        aria-hidden="true"
                                      >
                                        <path
                                          d="M11.916 4.583a1.768 1.768 0 1 1 2.5 2.5l-7 7-3.416.917.916-3.417 7-7Z"
                                          stroke="currentColor"
                                          strokeWidth="1.6"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                        <path
                                          d="M10.833 5.667 14.333 9.167"
                                          stroke="currentColor"
                                          strokeWidth="1.6"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                      {hoveredEditMessageId === message.id ? (
                                        <span className="absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-[10px] border border-[#E5E5EA] bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                                          Редактировать
                                        </span>
                                      ) : null}
                                    </button>
                                  ) : null}
                                </div>

                                <div
                                  className={`relative inline-block min-h-[44px] min-w-[84px] max-w-full rounded-[22px] px-4 pb-[10px] pt-3 align-top text-[15px] leading-[21px] shadow-sm transition ${
                                    message.senderType === "supplier"
                                      ? "bg-[#0A84FF] text-white shadow-[0_10px_24px_rgba(10,132,255,0.24)]"
                                      : message.isInternal
                                        ? "border border-[#E4D5B7] bg-[#FFF8EE] text-[#6B4F1D] shadow-[0_10px_24px_rgba(193,129,43,0.12)]"
                                      : message.senderType === "manager"
                                        ? "bg-[#EAF8EF] text-[#166534] shadow-[0_10px_24px_rgba(31,139,76,0.14)]"
                                      : "border border-[#E6EAF2] bg-white text-[#1E1E1E] shadow-[0_16px_36px_rgba(15,23,42,0.08)]"
                                  }`}
                                >
                                  <div className="min-w-0 max-w-full">
                                    {authorLabel ? (
                                      <p
                                        className={`mb-1 text-[11px] font-semibold ${
                                          message.senderType === "supplier"
                                            ? "text-white/78"
                                            : message.isInternal
                                              ? "text-[#C1812B]"
                                            : message.senderType === "manager"
                                              ? "text-[#1F8B4C]"
                                            : "text-[#7A8495]"
                                        }`}
                                      >
                                        {authorLabel}
                                      </p>
                                    ) : null}
                                    {message.isInternal ? (
                                      <p className="mb-1 text-[11px] font-semibold text-[#C1812B]">
                                        Комментарий менеджера
                                      </p>
                                    ) : null}
                                    {message.replyToContent || replyMap[message.id] ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          focusReplyMessage(
                                            message.replyToMessageId ?? replyMap[message.id]?.replyToId ?? ""
                                          )
                                        }
                                        className={`mb-2 block min-w-0 max-w-full rounded-[16px] px-2.5 py-2 text-left transition ${
                                          message.senderType === "supplier"
                                            ? "hover:bg-white/10"
                                            : message.isInternal
                                              ? "hover:bg-[#FFF3E3]"
                                            : message.senderType === "manager"
                                              ? "hover:bg-[#DCF3E3]"
                                            : "hover:bg-[#F2F7FF]"
                                        }`}
                                      >
                                        <div className="flex min-w-0 items-start gap-2">
                                          <span
                                            className={`mt-0.5 h-[20px] w-[3px] shrink-0 rounded-full ${
                                              message.senderType === "supplier"
                                                ? "bg-white/55"
                                                : message.isInternal
                                                  ? "bg-[#C1812B]"
                                                : message.senderType === "manager"
                                                  ? "bg-[#1F8B4C]"
                                                : "bg-[#0A84FF]"
                                            }`}
                                          />
                                          <div className="min-w-0">
                                          <p
                                            className={`text-[11px] font-semibold ${
                                              message.senderType === "supplier"
                                                ? "text-white/78"
                                                : message.isInternal
                                                  ? "text-[#C1812B]"
                                                : message.senderType === "manager"
                                                  ? "text-[#1F8B4C]"
                                                : "text-[#0A84FF]"
                                            }`}
                                          >
                                            Ответ
                                          </p>
                                          <p
                                            className={`mt-1 line-clamp-2 text-[13px] leading-[18px] [overflow-wrap:break-word] [word-break:normal] ${
                                              message.senderType === "supplier"
                                                ? "text-white/82"
                                                : message.isInternal
                                                  ? "text-[#8A6A35]"
                                                : message.senderType === "manager"
                                                  ? "text-[#2F6B45]"
                                                : "text-[#5A6270]"
                                            }`}
                                          >
                                            {message.replyToContent ?? replyMap[message.id]?.replyToContent}
                                          </p>
                                        </div>
                                        </div>
                                      </button>
                                    ) : null}
                                    {message.attachments && message.attachments.length > 0 ? (
                                      <ChatAttachmentList
                                        attachments={message.attachments}
                                        tone={
                                          message.senderType === "supplier"
                                            ? "outgoing"
                                            : "incoming"
                                        }
                                      />
                                    ) : (
                                      <p className="min-w-0 max-w-full whitespace-pre-wrap pr-[76px] [overflow-wrap:break-word] [word-break:normal]">
                                        {renderHighlightedText(
                                          message.displayContent,
                                          chatSearchQuery
                                        )}
                                      </p>
                                    )}
                                    <div
                                      className={`absolute bottom-[10px] right-4 inline-flex items-center gap-1 whitespace-nowrap text-[12px] leading-none ${
                                        message.senderType === "supplier"
                                          ? "text-white/65"
                                          : message.isInternal
                                            ? "text-[#8B6A33]"
                                          : message.senderType === "manager"
                                            ? "text-[#4F8B66]"
                                          : "text-[#8E8E93]"
                                      }`}
                                    >
                                      <p className="shrink-0">
                                        {formatTimeLabel(message.createdAt)}
                                      </p>
                                      {message.senderType === "supplier" ? (
                                        <MessageStatusChecks status={message.status} />
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            )}
                          </div>
                        );
                      })}

                    <div ref={messagesEndRef} />
                  </div>
                </div>

                {toast ? (
                  <div className="pointer-events-none absolute right-[344px] top-[96px] z-30">
                    <div
                      className={`min-w-[300px] rounded-[24px] border px-5 py-4 shadow-[0_24px_60px_rgba(15,23,42,0.16)] backdrop-blur-sm ${
                        toast.tone === "error"
                          ? "border-[#FFD5D5] bg-[#FFF6F6] text-[#C53C3C]"
                          : toast.tone === "info"
                            ? "border-[#D6E7FF] bg-[#F6FAFF] text-[#0A84FF]"
                            : "border-[#BDE9CB] bg-[linear-gradient(135deg,#F1FFF5_0%,#E3F9EA_100%)] text-[#167C3E]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${
                            toast.tone === "error"
                              ? "bg-[#FFE3E3] text-[#C53C3C]"
                              : toast.tone === "info"
                                ? "bg-[#EAF3FF] text-[#0A84FF]"
                                : "bg-[#DDF6E5] text-[#1F8B4C]"
                          }`}
                        >
                          {toast.tone === "error" ? "!" : toast.tone === "info" ? "i" : "✓"}
                        </div>
                        <div>
                          <p className="text-[15px] font-semibold leading-none">
                            {toast.tone === "success"
                              ? "Диалог завершён"
                              : toast.tone === "error"
                                ? "Не удалось сохранить"
                                : "Обратите внимание"}
                          </p>
                          <p className="mt-2 text-sm font-medium leading-[1.35] opacity-90">
                            {toast.message}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {showScrollToLatest ? (
                  <div className="pointer-events-none absolute bottom-[168px] left-1/2 z-30 -translate-x-1/2">
                    <button
                      type="button"
                      onClick={() => scrollSupplierChatToBottom("smooth")}
                      aria-label={
                        pendingClientMessageCount > 0
                          ? `Прокрутить чат вниз, новых сообщений: ${pendingClientMessageCount}`
                          : "Прокрутить чат вниз"
                      }
                      className="pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#0A84FF] text-lg font-semibold text-white shadow-[0_16px_30px_rgba(10,132,255,0.28)] transition hover:-translate-y-0.5 hover:bg-[#0077F2]"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/18 animate-pulse">
                        ↓
                      </span>
                    </button>
                  </div>
                ) : null}

                {shouldShowClientOfflineHint ? (
                  <div className="border-t border-transparent bg-white px-6 pb-2 pt-1">
                    <div className="mx-auto w-full max-w-3xl">
                      <div className="inline-flex items-center rounded-[16px] bg-[#F7F8FB] px-4 py-2 text-xs font-medium text-[#8E8E93]">
                        Пользователь не на сайте
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="border-t border-[#E5E5EA] bg-white px-6 py-5">
                  <div className="mx-auto w-full max-w-3xl">
                    {isSupplierDialogResolved ? (
                      <div className="rounded-[24px] border border-[#E5E5EA] bg-[#F7F7FA] px-5 py-4 text-center shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                        <p className="text-sm font-medium text-[#1E1E1E]">
                          Вы закончили диалог
                        </p>
                        <p className="mt-1 text-xs text-[#8E8E93]">
                          Пока диалог завершён, новое сообщение клиенту отправить нельзя.
                        </p>
                      </div>
                    ) : canSupplierTakeRequestInWork ? (
                      <div className="rounded-[24px] border border-[#DCE7FF] bg-[linear-gradient(135deg,#F8FBFF_0%,#EEF6FF_100%)] px-5 py-5 shadow-[0_14px_32px_rgba(10,132,255,0.10)]">
                        <p className="text-center text-sm font-semibold text-[#1E1E1E]">
                          Новый запрос ожидает ответа
                        </p>
                        <button
                          type="button"
                          onClick={handleTakeRequestInWork}
                          disabled={isSendingReply}
                          className="mt-4 inline-flex w-full items-center justify-center rounded-[18px] bg-[#0A84FF] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(10,132,255,0.24)] transition hover:-translate-y-0.5 hover:bg-[#0077F2] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
                        >
                          {isSendingReply ? "Берём в работу..." : "Взять в работу"}
                        </button>
                      </div>
                    ) : isSelectedRequestClaimedByAnotherSupplier ? (
                      <div className="rounded-[24px] border border-[#F4E3C2] bg-[#FFFBF4] px-5 py-4 text-center shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                        <p className="text-sm font-medium text-[#1E1E1E]">
                          Диалог уже взят в работу
                        </p>
                        <p className="mt-1 text-xs text-[#8E8E93]">
                          {selectedActiveRequest?.assignedSupplierProfileName
                            ? `Сейчас этот запрос ведёт ${selectedActiveRequest.assignedSupplierProfileName}.`
                            : "Сейчас этот запрос ведёт другой сотрудник поставщика."}
                        </p>
                      </div>
                    ) : isSupplierWaitingForManager ? (
                      <div className="rounded-[24px] border border-[#DCE7FF] bg-[linear-gradient(135deg,#F8FBFF_0%,#EEF6FF_100%)] px-5 py-5 shadow-[0_14px_32px_rgba(10,132,255,0.10)]">
                        <p className="text-center text-sm font-semibold text-[#1E1E1E]">
                          Ожидайте, менеджер скоро запустит вас в чат
                        </p>
                        <p className="mt-2 text-center text-xs leading-5 text-[#8E8E93]">
                          Как только менеджер подтвердит вход или если ответ не поступит вовремя,
                          поле ввода появится автоматически
                        </p>
                      </div>
                    ) : isSupplierPausedByManager ? (
                      <div className="rounded-[24px] border border-[#E5D2B8] bg-[#FFF9F2] px-5 py-5 shadow-[0_14px_32px_rgba(193,129,43,0.10)]">
                        <p className="text-center text-sm font-semibold text-[#1E1E1E]">
                          Вы на паузе
                        </p>
                        <p className="mt-2 text-center text-xs leading-5 text-[#8E8E93]">
                          Новые сообщения клиента и менеджера временно скрыты
                        </p>
                        <button
                          type="button"
                          onClick={handleResumeSupplierSync}
                          disabled={isResumingSupplierSync || !supplierSupervisorPowerEnabled}
                          className="mt-4 inline-flex w-full items-center justify-center rounded-[18px] bg-[#0A84FF] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(10,132,255,0.24)] transition hover:-translate-y-0.5 hover:bg-[#0077F2] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
                        >
                          {isResumingSupplierSync ? "Возвращаем..." : "Вернуться в диалог"}
                        </button>
                      </div>
                    ) : attachmentName ? (
                      <div className="mb-3 flex">
                        <div className="inline-flex items-center gap-2 rounded-full border border-[#D8D8DE] bg-[#F7F7FA] px-3 py-1.5 text-sm text-[#1E1E1E]">
                          <span className="max-w-[240px] truncate">{attachmentName}</span>
                          <button
                            onClick={() => {
                              setAttachmentName("");
                              setSelectedFiles([]);
                            }}
                            className="text-[#8E8E93] transition hover:text-[#1E1E1E]"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {replyTarget ? (
                      <div className="mb-3 flex items-start justify-between gap-3 rounded-[16px] border border-[#DCE7FF] bg-[#F5F9FF] px-3 py-3">
                        <button
                          type="button"
                          onClick={() => focusReplyMessage(replyTarget.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="text-xs font-semibold text-[#0A84FF]">Ответ на сообщение</p>
                          <p className="mt-1 line-clamp-2 text-xs text-[#5A6270]">
                            {getReplyPreviewContent(replyTarget)}
                          </p>
                        </button>
                        <button
                          onClick={() => setReplyTarget(null)}
                          className="shrink-0 text-sm text-[#8E8E93] transition hover:text-[#1E1E1E]"
                        >
                          ×
                        </button>
                      </div>
                    ) : null}

                    {editTarget ? (
                      <div className="mb-3 flex items-start justify-between gap-3 rounded-[16px] border border-[#F6D7B0] bg-[#FFF8EE] px-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-[#C1812B]">
                            Редактирование сообщения
                          </p>
                          <p className="mt-1 line-clamp-2 text-xs text-[#7A6A50]">
                            {editTarget.originalText}
                          </p>
                        </div>
                        <button
                          onClick={cancelEditingMessage}
                          className="shrink-0 text-sm text-[#8E8E93] transition hover:text-[#1E1E1E]"
                        >
                          ×
                        </button>
                      </div>
                    ) : null}

                    {canSupplierReply ? (
                      <>
                      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[18px] border border-[#F1DFC7]/0 bg-transparent px-0 py-0">
                        <button
                          type="button"
                          onClick={() => setSendMode("chat")}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                            sendMode === "chat"
                              ? "bg-[#0A84FF] text-white shadow-[0_8px_16px_rgba(10,132,255,0.18)]"
                              : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#E9EEF8]"
                          }`}
                        >
                          Чат
                        </button>
                        <button
                          type="button"
                          onClick={() => setSendMode("email")}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                            sendMode === "email"
                              ? "bg-[#111827] text-white shadow-[0_8px_16px_rgba(17,24,39,0.18)]"
                              : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#ECEEF5]"
                          }`}
                        >
                          Email
                        </button>
                        {sendMode === "chat" ? (
                          <div className="ml-auto flex min-w-[280px] flex-1 items-center gap-2">
                            <div className="relative min-w-[220px] flex-1">
                              <svg
                                viewBox="0 0 20 20"
                                fill="none"
                                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8E8E93]"
                                aria-hidden="true"
                              >
                                <circle
                                  cx="9"
                                  cy="9"
                                  r="5.75"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                />
                                <path
                                  d="M13.5 13.5L16.5 16.5"
                                  stroke="currentColor"
                                  strokeWidth="1.6"
                                  strokeLinecap="round"
                                />
                              </svg>
                              <input
                                value={chatSearchQuery}
                                onChange={(event) => {
                                  setChatSearchQuery(event.target.value);
                                  setActiveChatSearchMatchIndex(0);
                                }}
                                placeholder="Поиск по чату"
                                className="w-full rounded-full border border-[#E3E5EA] bg-white py-2 pl-10 pr-4 text-sm text-[#1E1E1E] outline-none placeholder:text-[#8E8E93]"
                              />
                            </div>
                            {chatSearchQuery.trim() ? (
                              <>
                                <span className="shrink-0 text-xs font-medium text-[#8E8E93]">
                                  {supplierChatSearchMatchIds.length
                                    ? `${normalizedActiveChatSearchMatchIndex + 1}/${supplierChatSearchMatchIds.length}`
                                    : "0"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => moveChatSearchMatch(-1)}
                                  disabled={supplierChatSearchMatchIds.length === 0}
                                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F2F2F7] text-[#6C6C70] transition hover:bg-[#E9EEF8] disabled:opacity-40"
                                  aria-label="Предыдущее совпадение"
                                >
                                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                                    <path
                                      d="M10 6L6 10L10 14"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M14 6L10 10L14 14"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveChatSearchMatch(1)}
                                  disabled={supplierChatSearchMatchIds.length === 0}
                                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F2F2F7] text-[#6C6C70] transition hover:bg-[#E9EEF8] disabled:opacity-40"
                                  aria-label="Следующее совпадение"
                                >
                                  <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
                                    <path
                                      d="M10 6L14 10L10 14"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M6 6L10 10L6 14"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </>
                            ) : null}
                          </div>
                        ) : null}
                        {sendMode === "email" ? (
                          <>
                            <span className="ml-1 text-sm font-medium text-[#9A6B2E]">
                              Получатель:
                            </span>
                            <input
                              value={emailRecipient}
                              onChange={(event) => setEmailRecipient(event.target.value)}
                              placeholder="client@example.com"
                              className="min-w-[240px] flex-1 rounded-full border border-[#E5D2B8] bg-[#FFF9F2] px-4 py-2 text-sm text-[#1E1E1E] outline-none placeholder:text-[#B7A48B]"
                            />
                          </>
                        ) : null}
                      </div>
                      <div className="flex items-end gap-3 rounded-[28px] border border-[#E3E5EA] bg-white px-5 py-3 shadow-[0_14px_32px_rgba(15,23,42,0.08)]">
                      <div className="min-w-0 flex-1">
                        <textarea
                          ref={composerTextareaRef}
                          value={replyText}
                          disabled={!supplierSupervisorPowerEnabled}
                          onChange={(event) => setReplyText(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault();
                              void handleSendReply();
                            }
                          }}
                          rows={1}
                          className="min-h-[40px] max-h-[132px] w-full resize-none overflow-y-auto bg-transparent py-2 text-[15px] leading-6 text-[#1E1E1E] outline-none placeholder:text-[#8E8E93]"
                          placeholder={
                            !supplierSupervisorPowerEnabled
                              ? "Режим ответа выключен: доступно только чтение"
                              : "Напишите сообщение..."
                          }
                        />
                      </div>

                      <div ref={quickRepliesRef} className="relative flex items-center gap-2">
                        {showQuickReplies ? (
                          <div className="absolute bottom-[calc(100%+14px)] right-24 z-20 w-[340px] rounded-[20px] border border-[#E4E6EB] bg-white p-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                            <div className="mb-3 px-1 text-[13px] font-semibold text-[#1E1E1E]">
                              Быстрые фразы
                            </div>
                            <input
                              value={quickReplySearch}
                              onChange={(event) => setQuickReplySearch(event.target.value)}
                              className="mb-3 w-full rounded-xl border border-[#E5E5EA] bg-[#FBFBFD] px-3 py-2 text-sm text-[#1E1E1E] outline-none placeholder:text-[#8E8E93]"
                              placeholder="Поиск по фразам..."
                            />
                            <div className="max-h-[240px] space-y-1 overflow-y-auto">
                              {filteredQuickReplies.map((phrase) => (
                                <button
                                  key={phrase}
                                  onClick={() => {
                                    setReplyText(phrase);
                                    setShowQuickReplies(false);
                                    setQuickReplySearch("");
                                  }}
                                  className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-[#1E1E1E] transition hover:bg-[#F5F8FF]"
                                >
                                  {phrase}
                                </button>
                              ))}
                              {filteredQuickReplies.length === 0 ? (
                                <div className="rounded-xl px-3 py-4 text-sm text-[#8E8E93]">
                                  Ничего не найдено
                                </div>
                              ) : null}
                            </div>
                            <button
                              onClick={handleAddQuickReply}
                              className="mt-3 w-full rounded-xl border border-[#DCE7FF] bg-[#F5F9FF] px-3 py-2.5 text-sm font-medium text-[#0A84FF] transition hover:bg-[#ECF4FF]"
                            >
                              + Добавить фразу
                            </button>
                          </div>
                        ) : null}

                        {showEmojiPicker ? (
                          <div className="absolute bottom-[calc(100%+14px)] right-10 z-20 w-[300px] rounded-[20px] border border-[#E4E6EB] bg-white p-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                            <div className="mb-3 px-1 text-[13px] font-semibold text-[#1E1E1E]">
                              Смайлики
                            </div>
                            <div className="grid grid-cols-5 gap-2">
                              {EMOJI_REACTIONS.map((emoji) => (
                                <button
                                  key={emoji}
                                  onClick={() => {
                                    setReplyText((prev) => `${prev}${emoji}`);
                                    setShowEmojiPicker(false);
                                  }}
                                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#FBFBFD] text-xl transition hover:bg-[#EEF6FF]"
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <button
                          onClick={() => {
                            setShowQuickReplies((prev) => !prev);
                            setShowEmojiPicker(false);
                          }}
                          onMouseEnter={() => setHoveredComposerAction("quick")}
                          onMouseLeave={() => setHoveredComposerAction(null)}
                          disabled={!supplierSupervisorPowerEnabled}
                          className={`relative flex h-[38px] w-[38px] items-center justify-center rounded-xl transition ${
                            showQuickReplies
                              ? "bg-[#E5F0FF]"
                              : "bg-transparent hover:bg-[#E5F0FF]"
                          }`}
                        >
                          <Image
                            src="/icons/fraza.svg"
                            alt="Быстрые фразы"
                            width={18}
                            height={18}
                            className="h-[18px] w-[18px]"
                            style={{
                              filter:
                                showQuickReplies || hoveredComposerAction === "quick"
                                  ? "brightness(0) saturate(100%) invert(38%) sepia(98%) saturate(2437%) hue-rotate(204deg) brightness(102%) contrast(101%)"
                                  : "brightness(0) saturate(100%) invert(59%) sepia(7%) saturate(205%) hue-rotate(202deg) brightness(91%) contrast(90%)",
                            }}
                          />
                          {hoveredComposerAction === "quick" && !showQuickReplies ? (
                            <div className="absolute bottom-[calc(100%+10px)] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-[10px] border border-[#E5E5EA] bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                              Быстрые фразы
                            </div>
                          ) : null}
                        </button>

                        <button
                          onClick={() => {
                            setShowEmojiPicker((prev) => !prev);
                            setShowQuickReplies(false);
                          }}
                          onMouseEnter={() => setHoveredComposerAction("emoji")}
                          onMouseLeave={() => setHoveredComposerAction(null)}
                          disabled={!supplierSupervisorPowerEnabled}
                          className={`relative flex h-[38px] w-[38px] items-center justify-center rounded-xl transition ${
                            showEmojiPicker
                              ? "bg-[#E5F0FF]"
                              : "bg-transparent hover:bg-[#E5F0FF]"
                          }`}
                        >
                          <Image
                            src="/icons/smail.svg"
                            alt="Смайлики"
                            width={18}
                            height={18}
                            className="h-[18px] w-[18px]"
                            style={{
                              filter:
                                showEmojiPicker || hoveredComposerAction === "emoji"
                                  ? "brightness(0) saturate(100%) invert(38%) sepia(98%) saturate(2437%) hue-rotate(204deg) brightness(102%) contrast(101%)"
                                  : "brightness(0) saturate(100%) invert(59%) sepia(7%) saturate(205%) hue-rotate(202deg) brightness(91%) contrast(90%)",
                            }}
                          />
                          {hoveredComposerAction === "emoji" && !showEmojiPicker ? (
                            <div className="absolute bottom-[calc(100%+10px)] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-[10px] border border-[#E5E5EA] bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                              Смайлики
                            </div>
                          ) : null}
                        </button>

                        <button
                          onClick={() => fileInputRef.current?.click()}
                          disabled={!supplierSupervisorPowerEnabled}
                          onMouseEnter={() => setHoveredComposerAction("file")}
                          onMouseLeave={() => setHoveredComposerAction(null)}
                          className="relative flex h-[38px] w-[38px] items-center justify-center rounded-xl transition hover:bg-[#E5F0FF]"
                        >
                          <Image
                            src="/icons/skrepka.svg"
                            alt="Вложить файл"
                            width={18}
                            height={18}
                            className="h-[18px] w-[18px]"
                            style={{
                              filter:
                                hoveredComposerAction === "file"
                                  ? "brightness(0) saturate(100%) invert(38%) sepia(98%) saturate(2437%) hue-rotate(204deg) brightness(102%) contrast(101%)"
                                  : "brightness(0) saturate(100%) invert(59%) sepia(7%) saturate(205%) hue-rotate(202deg) brightness(91%) contrast(90%)",
                            }}
                          />
                          {hoveredComposerAction === "file" ? (
                            <div className="absolute bottom-[calc(100%+10px)] left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-[10px] border border-[#E5E5EA] bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                              Вложить файл
                            </div>
                          ) : null}
                        </button>

                        <input
                          ref={fileInputRef}
                          type="file"
                          multiple
                          accept={CHAT_ATTACHMENT_ACCEPT}
                          disabled={!supplierSupervisorPowerEnabled}
                          className="hidden"
                          onChange={(event) => {
                            const files = Array.from(event.target.files ?? []);
                            if (files.length === 0) {
                              setSelectedFiles([]);
                              setAttachmentName("");
                              event.target.value = "";
                              return;
                            }

                            const validationMessage = validateChatAttachmentFiles(files);

                            if (validationMessage) {
                              setReplyError(validationMessage);
                              setSelectedFiles([]);
                              setAttachmentName("");
                              event.target.value = "";
                              return;
                            }

                            setReplyError("");
                            setSelectedFiles(files);
                            setAttachmentName(getChatAttachmentSelectionSummary(files));
                            event.target.value = "";
                          }}
                        />
                      </div>

                      <button
                        onClick={handleSendReply}
                        disabled={
                          !supplierSupervisorPowerEnabled ||
                          isSendingReply ||
                          (!replyText.trim() && selectedFiles.length === 0)
                        }
                        onMouseEnter={() => setHoveredComposerAction("send")}
                        onMouseLeave={() => setHoveredComposerAction(null)}
                        className="relative flex h-[46px] w-[46px] items-center justify-center rounded-full bg-[#0A84FF] shadow-[0_12px_22px_rgba(10,132,255,0.24)] transition hover:-translate-y-0.5 hover:bg-[#0077F2] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
                      >
                        <Image
                          src="/icons/otpravit.svg"
                          alt="Отправить"
                          width={19}
                          height={19}
                          className="h-[19px] w-[19px]"
                        />
                        {hoveredComposerAction === "send" ? (
                          <div className="absolute bottom-[calc(100%+10px)] right-0 z-20 whitespace-nowrap rounded-[10px] border border-[#E5E5EA] bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_8px_18px_rgba(15,23,42,0.08)]">
                            Отправить
                          </div>
                          ) : null}
                      </button>
                      </div>
                      </>
                    ) : null}

                    {!supplierSupervisorPowerEnabled ? (
                      <p className="mt-3 text-sm text-[#8E8E93]">
                        Молния выключена: управленец может читать диалоги, но не получает уведомления и не может писать.
                      </p>
                    ) : null}

                    {replyError ? (
                      <p className="mt-3 text-sm text-red-500">{replyError}</p>
                    ) : null}
                  </div>
                </div>
              </section>

              <aside className="flex h-full w-[320px] shrink-0 flex-col overflow-y-auto border-l border-[#E5E5EA] bg-[#FBFBFD] px-4 py-5">
                {supplierPanelStatus ? (
                  <div
                    className={`mb-4 rounded-[18px] border bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)] ${supplierPanelStatus.cardClassName}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                          Статус
                        </p>
                        <span className={`h-2.5 w-2.5 rounded-full ${supplierPanelStatus.accentClassName}`} />
                      </div>
                      <span
                        className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${supplierPanelStatus.badgeClassName}`}
                      >
                        {supplierPanelStatus.label}
                      </span>
                    </div>
                  </div>
                ) : null}

                <div className="mb-4 rounded-[18px] border border-[#E5E5EA] bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                    Запрос от менеджера
                  </p>
                  <div className="mt-4 rounded-[18px] border border-[#CFE0FF] bg-[linear-gradient(135deg,#F4F8FF_0%,#EAF2FF_100%)] p-4 shadow-[0_16px_34px_rgba(10,132,255,0.10)]">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0A84FF]">
                        Активный запрос
                      </p>
                      <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-[#3267B2]">
                        Текущий
                      </span>
                    </div>
                    <p className="mt-3 text-[15px] font-medium leading-7 text-[#1E1E1E]">
                      {(selectedActiveRequest ?? selectedRequest).requestText}
                    </p>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-[#6C6C70]">
                    <p>Менеджер: {selectedManagerName}</p>
                    <p>Передан: {formatDateTimeLabel((selectedActiveRequest ?? selectedRequest).createdAt)}</p>
                  </div>
                  {selectedTicketRequests.length > 1 ? (
                    <div className="mt-4 border-t border-[#EEF0F4] pt-4">
                      <div className="sticky top-0 z-10 bg-white pb-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                            История запросов
                          </p>
                          <span className="rounded-full bg-[#F2F4F8] px-2.5 py-1 text-[11px] text-[#6C6C70]">
                            {filteredHistoryRequests.length}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[
                            ["all", "Все"],
                            ["day", "День"],
                            ["week", "Неделя"],
                            ["month", "Месяц"],
                            ["custom", "Дата"],
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() =>
                                setRequestHistoryFilter(value as SupplierRequestHistoryFilter)
                              }
                              className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                                requestHistoryFilter === value
                                  ? "bg-[#0A84FF] text-white"
                                  : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#E5E5EA]"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        {requestHistoryFilter === "custom" ? (
                          <div className="mt-3">
                            <input
                              type="date"
                              value={requestHistoryCustomDate}
                              onChange={(event) => setRequestHistoryCustomDate(event.target.value)}
                              className="w-full rounded-[12px] border border-[#D7DBE3] bg-[#FBFBFD] px-3 py-2 text-sm text-[#1E1E1E] outline-none"
                            />
                          </div>
                        ) : null}
                      </div>
                      <div
                        className={`space-y-3 ${filteredHistoryRequests.length > 3 ? "max-h-[360px] overflow-y-auto pr-1" : ""}`}
                      >
                        {filteredHistoryRequests.map((request) => (
                          <div
                            key={request.id}
                            className={`rounded-[14px] border p-3 ${
                              request.id === (selectedActiveRequest ?? selectedRequest).id
                                ? "border-[#CFE0FF] bg-[#F5F9FF]"
                                : "border-[#ECECF1] bg-[#FCFCFD]"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-xs font-medium text-[#6C6C70]">
                                {formatDateTimeLabel(request.createdAt)}
                              </span>
                              <span className="rounded-full bg-[#F2F2F7] px-2 py-1 text-[11px] text-[#6C6C70]">
                                {getSupplierRequestStatusLabel(request.status)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[#1E1E1E]">
                              {request.requestText}
                            </p>
                          </div>
                        ))}
                        {filteredHistoryRequests.length === 0 ? (
                          <div className="rounded-[14px] border border-dashed border-[#D8D8DE] bg-[#FBFBFD] p-4 text-sm text-[#8E8E93]">
                            По выбранному фильтру запросы не найдены.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                {supplierSla ? (
                  <div className="mb-4 rounded-[18px] border border-[#E5E5EA] bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                          SLA
                        </p>
                        <p className="mt-3 text-sm font-medium text-[#1E1E1E]">
                          {supplierSla.label}
                        </p>
                        <p className={`mt-1 text-xs font-medium ${supplierSla.tone}`}>
                          {supplierSla.status}
                        </p>
                      </div>
                      <span className={`text-xs font-medium ${supplierSla.tone}`}>
                        {supplierSla.time}
                      </span>
                    </div>

                    <div className="mt-4 h-2 rounded-full bg-[#ECECF1]">
                      <div
                        className={`h-2 rounded-full ${supplierSla.bar}`}
                        style={{ width: supplierSla.progress }}
                      />
                    </div>
                  </div>
                ) : null}

                <ContactCard
                  contacts={ticketContacts}
                  canManage={false}
                  isLoading={isLoadingContacts}
                  error={contactsError}
                />
              </aside>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-8">
              <div className="mx-auto flex max-w-[420px] flex-col items-center text-center">
                <div className="relative h-[160px] w-[160px]">
                  <Image
                    src={supplierEmptyState.imageSrc}
                    alt={supplierEmptyState.title}
                    fill
                    className="object-contain"
                    sizes="160px"
                    priority
                    unoptimized
                  />
                </div>
                <h3 className="mt-4 text-[16px] font-semibold text-[#1E1E1E]">
                  {supplierEmptyState.title}
                </h3>
                <p className="mt-2 max-w-[360px] text-[13px] leading-6 text-[#8E8E93]">
                  {supplierEmptyState.description}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {isInviteModalOpen ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(30,30,30,0.28)] p-6">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8E8E93]">
                  Пригласить менеджера
                </p>
                <h3 className="mt-2 text-xl font-semibold text-[#1E1E1E]">
                  Подключить менеджера к диалогу
                </h3>
              </div>
              <button
                onClick={() => setIsInviteModalOpen(false)}
                className="rounded-full bg-[#F2F2F7] px-3 py-2 text-sm text-[#6C6C70]"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {availableManagers.map((manager) => (
                <button
                  key={manager.id}
                  onClick={() =>
                    manager.status === "online"
                      ? setSelectedInvitedManagerId(manager.id)
                      : undefined
                  }
                  disabled={manager.status !== "online"}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedInvitedManagerId === manager.id
                      ? "border-[#CFE1FF] bg-[#F3F8FF]"
                      : manager.status === "online"
                        ? "border-[#E5E5EA] bg-white"
                        : "border-[#E5E5EA] bg-[#F7F7FA] opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${supplierStatusDots[manager.status]}`} />
                      <p className="text-sm font-medium text-[#1E1E1E]">{manager.name}</p>
                    </div>
                    <span className="text-xs text-[#8E8E93]">
                      {supplierStatusLabels[manager.status]}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {inviteManagerError ? (
              <p className="mt-4 text-sm text-red-500">{inviteManagerError}</p>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsInviteModalOpen(false)}
                className="rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm text-[#6C6C70]"
              >
                Отмена
              </button>
              <button
                onClick={handleInviteManager}
                disabled={
                  isInvitingManager ||
                  availableManagers.find((manager) => manager.id === selectedInvitedManagerId)
                    ?.status !== "online"
                }
                className="rounded-2xl bg-[#0A84FF] px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {isInvitingManager ? "Приглашаем..." : "Пригласить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isTransferModalOpen ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(30,30,30,0.28)] p-6">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8E8E93]">
                  Передать диалог
                </p>
                <h3 className="mt-2 text-xl font-semibold text-[#1E1E1E]">
                  Выберите нового ответственного
                </h3>
              </div>
              <button
                onClick={() => setIsTransferModalOpen(false)}
                className="rounded-full bg-[#F2F2F7] px-3 py-2 text-sm text-[#6C6C70]"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-3">
              {availableManagers.map((manager) => (
                <button
                  key={manager.id}
                  onClick={() =>
                    manager.status === "online"
                      ? setSelectedTransferManagerId(manager.id)
                      : undefined
                  }
                  disabled={manager.status !== "online"}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedTransferManagerId === manager.id
                      ? "border-[#CFE1FF] bg-[#F3F8FF]"
                      : manager.status === "online"
                        ? "border-[#E5E5EA] bg-white"
                        : "border-[#E5E5EA] bg-[#F7F7FA] opacity-60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${supplierStatusDots[manager.status]}`} />
                      <p className="text-sm font-medium text-[#1E1E1E]">{manager.name}</p>
                    </div>
                    <span className="text-xs text-[#8E8E93]">
                      {supplierStatusLabels[manager.status]}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            {transferDialogError ? (
              <p className="mt-4 text-sm text-red-500">{transferDialogError}</p>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsTransferModalOpen(false)}
                className="rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm text-[#6C6C70]"
              >
                Отмена
              </button>
              <button
                onClick={handleTransferDialog}
                disabled={
                  isTransferringDialog ||
                  availableManagers.find((manager) => manager.id === selectedTransferManagerId)
                    ?.status !== "online"
                }
                className="rounded-2xl bg-[#0A84FF] px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {isTransferringDialog ? "Передаём..." : "Передать"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isQuickReplyModalOpen ? (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-[rgba(15,23,42,0.14)] p-6">
          <div className="w-full max-w-[520px] rounded-[30px] border border-[#E7E8EE] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8E8E93]">
                  Быстрые фразы
                </p>
                <h3 className="mt-2 text-[22px] font-semibold text-[#1E1E1E]">
                  Новая фраза
                </h3>
                <p className="mt-1 text-sm text-[#8E8E93]">
                  Добавьте шаблон ответа, чтобы быстрее отвечать в похожих ситуациях.
                </p>
              </div>

              <button
                onClick={() => {
                  setIsQuickReplyModalOpen(false);
                  setNewQuickReplyText("");
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F2F4F7] text-lg text-[#6C6C70] transition hover:bg-[#E8ECF3] hover:text-[#1E1E1E]"
              >
                ×
              </button>
            </div>

            <textarea
              value={newQuickReplyText}
              onChange={(event) => setNewQuickReplyText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSaveQuickReply();
                }
              }}
              rows={4}
              className="mt-5 min-h-[132px] w-full resize-none rounded-[24px] border border-[#D9E1EC] bg-[#FBFCFE] px-4 py-3 text-[15px] leading-6 text-[#1E1E1E] outline-none transition focus:border-[#0A84FF] focus:bg-white"
              placeholder="Например: Проверяю наличие и вернусь к вам через несколько минут."
              autoFocus
            />

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => {
                  setIsQuickReplyModalOpen(false);
                  setNewQuickReplyText("");
                }}
                className="rounded-[18px] border border-[#D7DCE5] bg-white px-5 py-3 text-sm font-medium text-[#6C6C70] transition hover:border-[#C8D0DC] hover:text-[#1E1E1E]"
              >
                Отмена
              </button>
              <button
                onClick={handleSaveQuickReply}
                disabled={!newQuickReplyText.trim()}
                className="rounded-[18px] bg-[#0A84FF] px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(10,132,255,0.22)] transition hover:-translate-y-0.5 hover:bg-[#0077F2] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
              >
                Добавить фразу
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
