"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api";
import { ChatAttachmentList } from "@/components/chat/attachment-card";
import { DialogListCard } from "@/components/chat/dialog-list-card";
import { DialogListWideRow } from "@/components/chat/dialog-list-wide-row";
import { MessageStatusChecks } from "@/components/chat/message-status-checks";
import { ContactCard, type ChatContactItem } from "@/components/chat/contact-card";
import { PageTrackingCard, type ChatPageViewItem } from "@/components/chat/page-tracking-card";
import { IncomingAlertStack } from "@/components/notifications/incoming-alert-stack";
import {
  clearAuthSession,
  getHomePathForRole,
  logoutServerSession,
  type ManagerPresence,
  managerAccounts,
  readAuthSession,
  writeAuthSession,
} from "@/lib/auth";
import {
  CHAT_ATTACHMENT_ACCEPT,
  type ChatAttachmentPayload,
  getChatAttachmentSelectionSummary,
  parseChatAttachmentPayloads,
  validateChatAttachmentFiles,
} from "@/lib/chat-attachments";
import { formatDialogActivityLabel } from "@/lib/dialog-list";
import { SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE } from "@/lib/supplier-request-sync";
import {
  fetchManagerStatusRecords,
  fetchManagerStatuses,
  fetchSupplierStatusRecords,
  resolveManagerProfileId,
  updateManagerPresence,
  type ManagerPresenceRecord,
  type SupplierPresenceRecord,
} from "@/lib/manager-presence";
import { playNotificationSound } from "@/lib/notification-sound";
import {
  isDesktopShell,
  shouldShowDesktopBackgroundNotification,
  showDesktopShellNotification,
} from "@/lib/runtime";

const REPEATED_NOTIFICATION_INTERVAL_MS = 40_000;
const CLIENT_ON_SITE_ACTIVITY_TTL_MS = 90_000;
const managerReplyMapStorageKey = "touchspace_manager_reply_map";

type MessageRole = "client" | "manager" | "supplier" | "ai" | "system";
type ReplyMeta = {
  replyToId: string;
  replyToContent: string;
};

type EditMeta = {
  messageId: string;
  originalText: string;
};

type ApiMessage = {
  id: string;
  content: string;
  senderType: string;
  senderProfileId?: string | null;
  senderName?: string | null;
  replyToMessageId?: string | null;
  replyToContent?: string | null;
  messageType?: string;
  transport?: string;
  toEmail?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  isInternal?: boolean;
  status: string;
  createdAt: string;
};

type ApiSupplierRequest = {
  id: string;
  ticketId: string;
  supplierId: string | null;
  supplierName: string;
  status: string;
  assignedSupplierProfileId?: string | null;
  assignedSupplierProfileName?: string | null;
  claimedAt?: string | null;
  claimRequiredAt?: string | null;
  claimMissedAt?: string | null;
  returnedToQueueAt?: string | null;
  requestText: string;
  slaMinutes: number | null;
  createdByManagerId: string | null;
  responseStartedAt: string | null;
  firstResponseAt: string | null;
  responseTime: number | null;
  responseBreached: boolean;
  supplierSyncPaused?: boolean;
  supplierSyncMode?: "live" | "paused" | "awaiting_manager";
  supplierSyncAwaitingManager?: boolean;
  supplierSyncPausedAt?: string | null;
  supplierSyncResumedAt?: string | null;
  supplierSyncResumeRequestedAt?: string | null;
  supplierSyncResumeDeferredAt?: string | null;
  supplierSyncManagerPromptAvailableAt?: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

type ApiTicketContactsResponse = {
  items?: ChatContactItem[];
};

type ApiTicketPageViewsResponse = {
  current?: ChatPageViewItem | null;
  items?: ChatPageViewItem[];
};

type SupplierCompanyOption = {
  supervisorProfileId: string;
  companyName: string;
  supplierId: string | null;
  supervisorName?: string | null;
};

type ApiTicket = {
  id: string;
  title: string;
  clientName?: string | null;
  clientId?: string | null;
  tradePointName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  currentUserEmail?: string | null;
  currentUserPhone?: string | null;
  superuserEmail?: string | null;
  superuserPhone?: string | null;
  canonicalEmail?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierCompanyName?: string | null;
  supplierContactName?: string | null;
  avatarColor?: string | null;
  avatarEmoji?: string | null;
  status?: string;
  pinned?: boolean;
  invitedManagerIds?: string[];
  invitedManagerNames?: string[];
  assignedManagerId?: string | null;
  assignedManagerName?: string | null;
  lastResolvedByManagerId?: string | null;
  lastResolvedByManagerName?: string | null;
  firstResponseStartedAt?: string | null;
  firstResponseAt?: string | null;
  firstResponseTime?: number | null;
  firstResponseBreached?: boolean;
  conversationMode?: string;
  currentHandlerType?: string;
  aiEnabled?: boolean;
  aiActivatedAt?: string | null;
  aiDeactivatedAt?: string | null;
  handedToManagerAt?: string | null;
  claimRequiredAt?: string | null;
  claimedAt?: string | null;
  claimMissedAt?: string | null;
  returnedToQueueAt?: string | null;
  rescueQueuedAt?: string | null;
  lastMessageAt?: string | null;
  resolvedAt?: string | null;
  messages?: ApiMessage[];
  supplierRequests?: ApiSupplierRequest[];
  pageViews?: ChatPageViewItem[];
};

type ChatMessage = {
  id: string;
  text: string;
  messageType?: string;
  transport?: string;
  isInternal?: boolean;
  from: MessageRole;
  senderProfileId?: string | null;
  senderName?: string | null;
  replyToMessageId?: string | null;
  replyToContent?: string | null;
  status: string;
  time: string;
  createdAt: string;
  toEmail?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  supplierName?: string;
  attachment?: ChatAttachmentPayload | null;
  attachments?: ChatAttachmentPayload[];
};

type ChatSupplierRequest = {
  id: string;
  supplierId: string | null;
  supplierName: string;
  status: string;
  requestText: string;
  slaMinutes: number | null;
  createdAt: string;
  createdAtRaw: string;
  responseStartedAt: string | null;
  firstResponseAt: string | null;
  responseTime: number | null;
  responseBreached: boolean;
  claimRequiredAt: string | null;
  claimMissedAt: string | null;
  returnedToQueueAt: string | null;
  claimedAt: string | null;
  assignedSupplierProfileId: string | null;
  assignedSupplierProfileName: string | null;
  supplierSyncPaused: boolean;
  supplierSyncMode: "live" | "paused" | "awaiting_manager";
  supplierSyncAwaitingManager: boolean;
  supplierSyncPausedAt: string | null;
  supplierSyncResumedAt: string | null;
  supplierSyncResumeRequestedAt: string | null;
  supplierSyncResumeDeferredAt: string | null;
  supplierSyncManagerPromptAvailableAt: string | null;
};

type SupplierRequestPeriodFilter = "today" | "yesterday" | "week" | "month" | "all";
type ChatDateFilterMode = "day" | "period";

type ChatItem = {
  id: string;
  title: string;
  status: string;
  headerStatus: string;
  rawStatus: string;
  pinned: boolean;
  invitedManagerIds: string[];
  invitedManagerNames: string[];
  assignedManagerId: string | null;
  assignedManagerName: string | null;
  lastResolvedByManagerId: string | null;
  lastResolvedByManagerName: string | null;
  firstResponseStartedAt: string | null;
  firstResponseAt: string | null;
  firstResponseTime: number | null;
  firstResponseBreached: boolean;
  conversationMode: string;
  currentHandlerType: string;
  aiEnabled: boolean;
  aiActivatedAt: string | null;
  aiDeactivatedAt: string | null;
  handedToManagerAt: string | null;
  claimRequiredAt: string | null;
  claimedAt: string | null;
  claimMissedAt: string | null;
  returnedToQueueAt: string | null;
  rescueQueuedAt: string | null;
  lastMessageAt: string | null;
  resolvedAt: string | null;
  clientId: string | null;
  clientName: string;
  tradePointName?: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  currentUserEmail: string | null;
  currentUserPhone: string | null;
  superuserEmail: string | null;
  superuserPhone: string | null;
  canonicalEmail: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierCompanyName: string | null;
  supplierContactName: string | null;
  avatarColor: string | null;
  avatarEmoji: string | null;
  messages: ChatMessage[];
  supplierRequests: ChatSupplierRequest[];
  pageViews: ChatPageViewItem[];
};

type NotificationCandidate = {
  notificationKey: string;
  ticketId: string;
  title: string;
  clientName: string | null;
  tradePointName?: string | null;
  messageId: string;
  messageText: string;
  createdAt: string;
  avatarColor?: string | null;
  avatarEmoji?: string | null;
  conversationMode?: string | null;
  scopeStatus:
    | "new_unclaimed"
    | "missed_unclaimed"
    | "rescue_queue"
    | "owned_active"
    | "claimed_by_other_recently";
  waitSeconds: number;
  assignedManagerId: string | null;
  assignedManagerName: string | null;
};

type ToastTone = "success" | "error" | "info";

type UiToast = {
  message: string;
  tone: ToastTone;
};

type ManagerMessageSuggestion = {
  text: string;
  usageCount: number;
  lastUsedAt: string;
};

type SlaVisual = {
  label: string;
  status: string;
  time: string;
  progress: string;
  bar: string;
  tone: string;
};

const initialChats: ChatItem[] = [];
const appFontFamily = "Montserrat, ui-sans-serif, system-ui, sans-serif";
const QUICK_REPLIES = [
  "Здравствуйте! Чем могу помочь?",
  "Уточню информацию, одну минуту",
  "Передаю запрос поставщику",
  "Спасибо за ожидание",
  "Можете уточнить номер заказа?",
];
const EMOJI_REACTIONS = ["🙂", "😊", "😉", "🤝", "👍", "✅", "🔥", "❤️", "😂", "🙏"];
const BASE_MANAGERS = Array.from(
  new Map(managerAccounts.map(({ id, name }) => [id, { id, name }])).values()
);
const GENERIC_MANAGER_NAMES = new Set(["менеджер"]);

const isSpecificManagerName = (name?: string | null) => {
  const normalizedName = name?.trim();
  return Boolean(normalizedName && !GENERIC_MANAGER_NAMES.has(normalizedName.toLowerCase()));
};

const resolveManagerSessionName = (
  sessionManagerName: string | undefined,
  sessionFullName: string | undefined,
  fallbackManagerName: string
) => {
  const normalizedSessionManagerName = sessionManagerName?.trim();
  const normalizedSessionFullName = sessionFullName?.trim();

  if (normalizedSessionManagerName && isSpecificManagerName(normalizedSessionManagerName)) {
    return normalizedSessionManagerName;
  }

  if (normalizedSessionFullName && isSpecificManagerName(normalizedSessionFullName)) {
    return normalizedSessionFullName;
  }

  return fallbackManagerName;
};

const dedupeManagers = <T extends { id: string; name: string }>(managers: T[]) =>
  Array.from(
    new Map(
      managers.map((manager) => [
        `${manager.id.trim()}::${manager.name.trim().toLowerCase()}`,
        manager,
      ])
    ).values()
  );
const managerStatusLabels: Record<ManagerPresence, string> = {
  online: "В сети",
  break: "На перерыве",
  offline: "Не в сети",
};
const managerStatusDots: Record<ManagerPresence, string> = {
  online: "bg-[#34C759]",
  break: "bg-[#FFB340]",
  offline: "bg-[#C7C7CC]",
};
const statusLabels: Record<string, string> = {
  open: "Новый",
  new: "Новый",
  resolved: "Решён",
  closed: "Закрыт",
  pending: "Ожидает",
  in_progress: "В работе",
  answered: "Ответ получен",
  cancelled: "Отменён",
  waiting_supplier: "Ждём поставщика",
  waiting_client: "Ждём клиента",
};

const getStatusLabel = (status?: string) => {
  if (!status) {
    return "Открыт";
  }

  return statusLabels[status] ?? status;
};

const getChatPreview = (chat: ChatItem) => {
  const lastMessage = getLastNonSystemMessage(chat) ?? chat.messages.at(-1);

  if (!lastMessage) {
    return "Диалог создан";
  }

  const previewSource =
    lastMessage.attachments && lastMessage.attachments.length > 0
      ? lastMessage.attachments.length === 1
        ? lastMessage.attachments[0].name
        : `${lastMessage.attachments.length} файлов`
      : lastMessage.text;

  return previewSource.length > 84 ? `${previewSource.slice(0, 84)}...` : previewSource;
};

const getUnreadCount = (chat: ChatItem) => {
  return chat.messages.filter(
    (message) =>
      (message.from === "client" || message.from === "supplier") &&
      message.status !== "read"
  ).length;
};

const getLastNonSystemMessage = (chat: ChatItem) => {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];

    if (message.from !== "system") {
      return message;
    }
  }

  return null;
};

const getChatTone = (chat: ChatItem) => {
  if (!chat.assignedManagerId && chat.rescueQueuedAt) {
    return {
      label: "Спасение чата",
      dot: "bg-[#FF7A00]",
      pill: "bg-[#FFF1E8] text-[#C35A00]",
    };
  }

  if (!chat.assignedManagerId && chat.claimMissedAt) {
    return {
      label: "Пропущен",
      dot: "bg-[#FD6868]",
      pill: "bg-[#FFE7E7] text-[#D64545]",
    };
  }

  if (chat.rawStatus === "resolved") {
    return {
      label: "Решён",
      dot: "bg-[#34C759]",
      pill: "bg-[#ECFFF1] text-[#1F8B4C]",
    };
  }

  if (chat.rawStatus === "closed") {
    return {
      label: "Закрыт",
      dot: "bg-[#C7C7CC]",
      pill: "bg-[#F2F2F7] text-[#8E8E93]",
    };
  }

  if (chat.rawStatus === "waiting_supplier") {
    return {
      label: "Ждём поставщика",
      dot: "bg-[#FFB340]",
      pill: "bg-[#FFF5E8] text-[#B7791F]",
    };
  }

  if (chat.rawStatus === "waiting_client") {
    return {
      label: "Ждём клиента",
      dot: "bg-[#FFB340]",
      pill: "bg-[#FFF5E8] text-[#B7791F]",
    };
  }

  if (chat.rawStatus === "in_progress") {
    return {
      label: "В работе",
      dot: "bg-[#0A84FF]",
      pill: "bg-[#EEF6FF] text-[#0A84FF]",
    };
  }

  return {
    label: "Новый",
    dot: "bg-[#8E8E93]",
    pill: "bg-[#F2F2F7] text-[#6C6C70]",
  };
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

const getSlaTone = (progressRatio: number) => {
  if (progressRatio < 0.5) {
    return {
      bar: "bg-[#34C759]",
      tone: "text-[#1F8B4C]",
      status: "В норме",
    };
  }

  if (progressRatio < 0.75) {
    return {
      bar: "bg-[#FFB340]",
      tone: "text-[#B7791F]",
      status: "Риск SLA",
    };
  }

  return {
    bar: "bg-[#FD6868]",
    tone: "text-[#D64545]",
    status: "Критично",
  };
};

const buildSlaVisual = ({
  label,
  startedAt,
  firstResponseAt,
  durationMs,
  breached,
  slaMs,
  now,
  inactiveText,
}: {
  label: string;
  startedAt?: string | null;
  firstResponseAt?: string | null;
  durationMs?: number | null;
  breached?: boolean;
  slaMs: number;
  now: number;
  inactiveText: string;
}): SlaVisual => {
  if (!startedAt) {
    return {
      label,
      status: "Не активирован",
      time: inactiveText,
      progress: "0%",
      bar: "bg-[#D1D1D6]",
      tone: "text-[#8E8E93]",
    };
  }

  if (firstResponseAt && durationMs !== null && durationMs !== undefined) {
    const ratio = Math.min(durationMs / slaMs, 1);
    const tone = breached
      ? { bar: "bg-[#FD6868]", tone: "text-[#D64545]", status: "Просрочено" }
      : getSlaTone(ratio);

    return {
      label,
      status: breached ? "Ответ с просрочкой" : "Ответ получен",
      time: `Ответ за ${formatDuration(durationMs)}`,
      progress: `${Math.max(ratio * 100, 8)}%`,
      bar: tone.bar,
      tone: tone.tone,
    };
  }

  const elapsedMs = Math.max(now - new Date(startedAt).getTime(), 0);
  const remainingMs = slaMs - elapsedMs;

  if (remainingMs <= 0) {
    return {
      label,
      status: "Просрочено",
      time: `Просрочка ${formatDuration(Math.abs(remainingMs))}`,
      progress: "100%",
      bar: "bg-[#FD6868]",
      tone: "text-[#D64545]",
    };
  }

  const ratio = Math.min(elapsedMs / slaMs, 1);
  const tone = getSlaTone(ratio);

  return {
    label,
    status: tone.status,
    time: `Осталось ${formatDuration(remainingMs)}`,
    progress: `${Math.max(ratio * 100, 8)}%`,
    bar: tone.bar,
    tone: tone.tone,
  };
};

const getStatusBadgeClass = (rawStatus?: string) => {
  if (rawStatus === "resolved") {
    return "bg-[#ECFFF1] text-[#1F8B4C]";
  }

  if (rawStatus === "waiting_supplier" || rawStatus === "waiting_client") {
    return "bg-[#FFF5E8] text-[#B7791F]";
  }

  if (rawStatus === "in_progress") {
    return "bg-[#EEF6FF] text-[#0A84FF]";
  }

  return "bg-[#F2F2F7] text-[#6C6C70]";
};

const formatMessage = (msg: ApiMessage): ChatMessage => {
  const attachments = parseChatAttachmentPayloads(msg.content);
  const normalizedContent = msg.content.trim();
  const managerSystemText =
    msg.senderType === "system" &&
    normalizedContent.startsWith("Запрос поставщику ") &&
    normalizedContent.includes('переведён в статус "Решён"')
      ? "Поставщик отметил диалог решённым. Вы снова ведёте диалог."
      : msg.messageType === "attachment" && attachments.length > 0
        ? attachments.length === 1
          ? attachments[0].name
          : `${attachments.length} файлов`
        : msg.content;

  return {
    id: msg.id,
    text: managerSystemText,
    messageType: msg.messageType,
    transport: msg.transport,
    from:
      msg.senderType === "client"
        ? "client"
        : msg.senderType === "ai"
          ? "ai"
        : msg.senderType === "supplier"
          ? "supplier"
          : msg.senderType === "system"
            ? "system"
            : "manager",
    status: msg.status,
    senderProfileId: msg.senderProfileId ?? null,
    senderName: msg.senderName ?? null,
    replyToMessageId: msg.replyToMessageId ?? null,
    replyToContent: msg.replyToContent ?? null,
    time: new Date(msg.createdAt).toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    createdAt: msg.createdAt,
    toEmail: msg.toEmail ?? null,
    fromEmail: msg.fromEmail ?? null,
    subject: msg.subject ?? null,
    isInternal: Boolean(msg.isInternal),
    attachment: attachments[0] ?? null,
    attachments,
  };
};

const getReplyPreviewContent = (message: ChatMessage) => {
  if (message.attachments && message.attachments.length > 0) {
    return message.attachments.length === 1
      ? message.attachments[0].name
      : `${message.attachments.length} файлов`;
  }

  return message.text;
};

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

const getDateInputValue = (value?: string | null) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const getManagerMessageAuthorLabel = (message: ChatMessage) => {
  if (message.isInternal || message.from === "ai" || message.from === "supplier") {
    return "";
  }

  if (message.from === "manager") {
    return "Вы";
  }

  if (message.from === "client") {
    return "Клиент";
  }

  return "";
};

const formatSupplierRequest = (
  request: ApiSupplierRequest
): ChatSupplierRequest => ({
  id: request.id,
  supplierId: request.supplierId ?? null,
  supplierName: request.supplierName,
  status: request.status,
  requestText: request.requestText,
  slaMinutes: request.slaMinutes,
  createdAt: new Date(request.createdAt).toLocaleString(),
  createdAtRaw: request.createdAt,
  responseStartedAt: request.responseStartedAt,
  firstResponseAt: request.firstResponseAt,
  responseTime: request.responseTime,
  responseBreached: request.responseBreached,
  claimRequiredAt: request.claimRequiredAt ?? null,
  claimMissedAt: request.claimMissedAt ?? null,
  returnedToQueueAt: request.returnedToQueueAt ?? null,
  claimedAt: request.claimedAt ?? null,
  assignedSupplierProfileId: request.assignedSupplierProfileId ?? null,
  assignedSupplierProfileName: request.assignedSupplierProfileName ?? null,
  supplierSyncPaused: Boolean(request.supplierSyncPaused),
  supplierSyncMode: request.supplierSyncMode ?? (request.supplierSyncPaused ? "paused" : "live"),
  supplierSyncAwaitingManager: Boolean(request.supplierSyncAwaitingManager),
  supplierSyncPausedAt: request.supplierSyncPausedAt ?? null,
  supplierSyncResumedAt: request.supplierSyncResumedAt ?? null,
  supplierSyncResumeRequestedAt: request.supplierSyncResumeRequestedAt ?? null,
  supplierSyncResumeDeferredAt: request.supplierSyncResumeDeferredAt ?? null,
  supplierSyncManagerPromptAvailableAt: request.supplierSyncManagerPromptAvailableAt ?? null,
});

const shouldIncludeManagerChatMessage = (message: ApiMessage) =>
  message.messageType !== SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE;

const extractApiErrorMessage = async (
  response: Response,
  fallback: string
): Promise<string> => {
  const responseText = await response.text();

  if (!responseText) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(responseText) as { message?: string | string[] };

    if (Array.isArray(parsed.message)) {
      return parsed.message.join(", ");
    }

    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message;
    }
  } catch {
    return responseText;
  }

  return responseText;
};

const formatRelativeClaimTime = (value?: string | null) => {
  if (!value) {
    return "";
  }

  const diffMs = Date.now() - new Date(value).getTime();

  if (diffMs < 60_000) {
    return "только что";
  }

  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 60) {
    return `${minutes} мин назад`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours} ч назад`;
  }

  const days = Math.floor(hours / 24);
  return `${days} дн назад`;
};

const matchesSupplierRequestPeriod = (
  createdAt: string,
  filter: SupplierRequestPeriodFilter
) => {
  if (filter === "all") {
    return true;
  }

  const createdDate = new Date(createdAt);

  if (Number.isNaN(createdDate.getTime())) {
    return false;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  const startOfMonth = new Date(startOfToday);
  startOfMonth.setMonth(startOfMonth.getMonth() - 1);

  if (filter === "today") {
    return createdDate >= startOfToday && createdDate < startOfTomorrow;
  }

  if (filter === "yesterday") {
    return createdDate >= startOfYesterday && createdDate < startOfToday;
  }

  if (filter === "week") {
    return createdDate >= startOfWeek;
  }

  if (filter === "month") {
    return createdDate >= startOfMonth;
  }

  return true;
};

const formatTicket = (ticket: ApiTicket): ChatItem => ({
  id: ticket.id,
  title: ticket.title,
  status: getStatusLabel(ticket.status || "open"),
  headerStatus: getStatusLabel(ticket.status || "open"),
  rawStatus: ticket.status || "open",
  pinned: ticket.pinned ?? false,
  invitedManagerIds: ticket.invitedManagerIds ?? [],
  invitedManagerNames: ticket.invitedManagerNames ?? [],
  assignedManagerId: ticket.assignedManagerId ?? null,
  assignedManagerName: ticket.assignedManagerName ?? null,
  lastResolvedByManagerId: ticket.lastResolvedByManagerId ?? null,
  lastResolvedByManagerName: ticket.lastResolvedByManagerName ?? null,
  firstResponseStartedAt: ticket.firstResponseStartedAt ?? null,
  firstResponseAt: ticket.firstResponseAt ?? null,
  firstResponseTime: ticket.firstResponseTime ?? null,
  firstResponseBreached: ticket.firstResponseBreached ?? false,
  conversationMode: ticket.conversationMode ?? "manager",
  currentHandlerType: ticket.currentHandlerType ?? "manager",
  aiEnabled: ticket.aiEnabled ?? false,
  aiActivatedAt: ticket.aiActivatedAt ?? null,
  aiDeactivatedAt: ticket.aiDeactivatedAt ?? null,
  handedToManagerAt: ticket.handedToManagerAt ?? null,
  claimRequiredAt: ticket.claimRequiredAt ?? null,
  claimedAt: ticket.claimedAt ?? null,
  claimMissedAt: ticket.claimMissedAt ?? null,
  returnedToQueueAt: ticket.returnedToQueueAt ?? null,
  rescueQueuedAt: ticket.rescueQueuedAt ?? null,
  lastMessageAt: ticket.lastMessageAt ?? null,
  resolvedAt: ticket.resolvedAt ?? null,
  clientId: ticket.clientId?.trim() || null,
  clientName:
    ticket.tradePointName?.trim() ||
    ticket.clientName?.trim() ||
    ticket.title ||
    "Реселлер",
  tradePointName: ticket.tradePointName?.trim() || null,
  clientEmail: ticket.clientEmail?.trim() || null,
  clientPhone: ticket.clientPhone?.trim() || null,
  currentUserEmail: ticket.currentUserEmail?.trim() || null,
  currentUserPhone: ticket.currentUserPhone?.trim() || null,
  superuserEmail: ticket.superuserEmail?.trim() || null,
  superuserPhone: ticket.superuserPhone?.trim() || null,
  canonicalEmail: ticket.canonicalEmail?.trim() || null,
  supplierId: ticket.supplierId?.trim() || null,
  supplierName: ticket.supplierName?.trim() || null,
  supplierCompanyName:
    ticket.supplierCompanyName?.trim() ||
    ticket.supplierName?.trim() ||
    null,
  supplierContactName: ticket.supplierContactName?.trim() || null,
  avatarColor: ticket.avatarColor ?? null,
  avatarEmoji: ticket.avatarEmoji ?? null,
  messages: Array.isArray(ticket.messages)
    ? ticket.messages.filter(shouldIncludeManagerChatMessage).map(formatMessage)
    : [],
  supplierRequests: Array.isArray(ticket.supplierRequests)
    ? ticket.supplierRequests.map(formatSupplierRequest)
    : [],
  pageViews: Array.isArray(ticket.pageViews) ? ticket.pageViews : [],
});

const getDirectSupplierCompanyName = (
  chat?: Pick<ChatItem, "supplierCompanyName" | "supplierName" | "clientName" | "title"> | null
) =>
  chat?.supplierCompanyName?.trim() ||
  chat?.supplierName?.trim() ||
  chat?.clientName?.trim() ||
  chat?.title?.replace(/^Поставщик:\s*/i, "").trim() ||
  "Поставщик";

const getDirectSupplierContactName = (
  chat?: Pick<ChatItem, "supplierContactName"> | null
) => chat?.supplierContactName?.trim() || null;

const getDirectSupplierDisplayName = (
  chat?: Pick<
    ChatItem,
    "supplierCompanyName" | "supplierName" | "supplierContactName" | "clientName" | "title"
  > | null
) => {
  const companyName = getDirectSupplierCompanyName(chat);
  const contactName = getDirectSupplierContactName(chat);

  return contactName ? `${contactName}/${companyName}` : companyName;
};

const getChatClientDisplayName = (
  chat?: Pick<
    ChatItem,
    | "clientId"
    | "clientName"
    | "tradePointName"
    | "conversationMode"
    | "supplierCompanyName"
    | "supplierName"
    | "supplierContactName"
    | "title"
  > | null
) =>
  chat?.conversationMode === "direct_supplier"
    ? getDirectSupplierDisplayName(chat)
    : chat?.tradePointName?.trim() ||
      chat?.clientName?.trim() ||
      chat?.clientId?.trim() ||
      "Реселлер";

const getDialogCycleBoundary = (chat: ChatItem) => {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];

    if (
      message.from === "system" &&
      (message.text.includes("Диалог отмечен как решённый менеджером") ||
        message.text.includes("снова открыл диалог"))
    ) {
      return new Date(message.createdAt).getTime();
    }
  }

  return null;
};

const getTopicMessage = (chat: ChatItem) => {
  const cycleBoundary = getDialogCycleBoundary(chat);
  const clientMessages = chat.messages.filter((message) => message.from === "client");
  const cycleMessage =
    (cycleBoundary
      ? clientMessages.find((message) => new Date(message.createdAt).getTime() > cycleBoundary)
      : null) ?? clientMessages[0] ?? getLastNonSystemMessage(chat);

  if (!cycleMessage?.text?.trim()) {
    return "Диалог создан";
  }

  return cycleMessage.text.trim();
};

const getChannelLabel = (chat: ChatItem) => {
  const cycleBoundary = getDialogCycleBoundary(chat);
  const cyclePageView =
    (cycleBoundary
      ? chat.pageViews.find((item) => new Date(item.visitedAt).getTime() > cycleBoundary)
      : null) ?? chat.pageViews[0] ?? null;

  return cyclePageView?.pageUrl?.trim() || cyclePageView?.pagePath?.trim() || "—";
};

const getChannelHref = (chat: ChatItem) => {
  const cycleBoundary = getDialogCycleBoundary(chat);
  const cyclePageView =
    (cycleBoundary
      ? chat.pageViews.find((item) => new Date(item.visitedAt).getTime() > cycleBoundary)
      : null) ?? chat.pageViews[0] ?? null;

  return cyclePageView?.pageUrl?.trim() || cyclePageView?.pagePath?.trim() || "";
};

const getFirstResponseWaitLabel = (chat: ChatItem) => {
  if (typeof chat.firstResponseTime === "number" && chat.firstResponseTime >= 0) {
    return formatDuration(chat.firstResponseTime);
  }

  if (chat.firstResponseStartedAt) {
    return formatDuration(Date.now() - new Date(chat.firstResponseStartedAt).getTime());
  }

  return "—";
};

const getDialogDurationLabel = (chat: ChatItem) => {
  if (!chat.handedToManagerAt) {
    return "—";
  }

  const startTime = new Date(chat.handedToManagerAt).getTime();
  const endTime = chat.resolvedAt
    ? new Date(chat.resolvedAt).getTime()
    : Date.now();

  return formatDuration(Math.max(endTime - startTime, 0));
};

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

export default function Home() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [currentManagerId, setCurrentManagerId] = useState("");
  const [currentManagerName, setCurrentManagerName] = useState("");
  const [currentManagerStatus, setCurrentManagerStatus] =
    useState<ManagerPresence>("online");
  const [isManagerMenuOpen, setIsManagerMenuOpen] = useState(false);
  const [managerStatuses, setManagerStatuses] = useState<Record<string, ManagerPresence>>({});
  const [managerPresenceRecords, setManagerPresenceRecords] = useState<
    ManagerPresenceRecord[]
  >([]);
  const [activeChatId, setActiveChatId] = useState("");
  const [messageText, setMessageText] = useState("");
  const [managerSuggestions, setManagerSuggestions] = useState<
    ManagerMessageSuggestion[]
  >([]);
  const [activeManagerSuggestionIndex, setActiveManagerSuggestionIndex] =
    useState(-1);
  const [quickReplies, setQuickReplies] = useState<string[]>(QUICK_REPLIES);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [quickReplySearch, setQuickReplySearch] = useState("");
  const [isQuickReplyModalOpen, setIsQuickReplyModalOpen] = useState(false);
  const [isCreateClientModalOpen, setIsCreateClientModalOpen] = useState(false);
  const [newQuickReplyText, setNewQuickReplyText] = useState("");
  const [hoveredComposerAction, setHoveredComposerAction] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [sendMode, setSendMode] = useState<"chat" | "email">("chat");
  const [emailRecipient, setEmailRecipient] = useState("");
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [activeChatSearchMatchIndex, setActiveChatSearchMatchIndex] = useState(0);
  const [supplierRequestSupplierFilter, setSupplierRequestSupplierFilter] =
    useState<string>("all");
  const [supplierRequestStatusFilter, setSupplierRequestStatusFilter] =
    useState<string>("all");
  const [supplierRequestPeriodFilter, setSupplierRequestPeriodFilter] =
    useState<SupplierRequestPeriodFilter>("all");
  const [isSupplierRequestsFilterOpen, setIsSupplierRequestsFilterOpen] = useState(false);
  const [isChatFiltersOpen, setIsChatFiltersOpen] = useState(false);
  const [chatStatusFilter, setChatStatusFilter] = useState<string>("all");
  const [chatDateFilterMode, setChatDateFilterMode] = useState<ChatDateFilterMode>("day");
  const [chatDateFilterDay, setChatDateFilterDay] = useState("");
  const [chatDateFilterFrom, setChatDateFilterFrom] = useState("");
  const [chatDateFilterTo, setChatDateFilterTo] = useState("");
  const [chatData, setChatData] = useState<ChatItem[]>(initialChats);
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredHeaderAction, setHoveredHeaderAction] = useState<string | null>(null);
  const [filter, setFilter] = useState<"incoming" | "in_progress" | "supplier" | "all">("incoming");
  const [isChatPaneDismissed, setIsChatPaneDismissed] = useState(false);

  const [isSupplierFormOpen, setIsSupplierFormOpen] = useState(false);
  const [supplierCompanies, setSupplierCompanies] = useState<SupplierCompanyOption[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [supplierRequestText, setSupplierRequestText] = useState("");
  const [supplierFollowUpText, setSupplierFollowUpText] = useState("");
  const [isLoadingSupplierRequests, setIsLoadingSupplierRequests] = useState(false);
  const [supplierRequestsError, setSupplierRequestsError] = useState("");
  const [isCreatingSupplierRequest, setIsCreatingSupplierRequest] = useState(false);
  const [isSendingSupplierFollowUp, setIsSendingSupplierFollowUp] = useState(false);
  const [isResolvingSupplierRequest, setIsResolvingSupplierRequest] = useState(false);
  const [isTogglingSupplierSync, setIsTogglingSupplierSync] = useState(false);
  const [createSupplierRequestError, setCreateSupplierRequestError] = useState("");
  const [supplierFollowUpError, setSupplierFollowUpError] = useState("");
  const [supplierCompaniesError, setSupplierCompaniesError] = useState("");
  const [isTogglingPinned, setIsTogglingPinned] = useState(false);
  const [isClaimingIncoming, setIsClaimingIncoming] = useState(false);
  const [isResolvingTicket, setIsResolvingTicket] = useState(false);
  const [isResolveSupplierConfirmOpen, setIsResolveSupplierConfirmOpen] = useState(false);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isJoinActiveDialogConfirmOpen, setIsJoinActiveDialogConfirmOpen] = useState(false);
  const [selectedInvitedManagerId, setSelectedInvitedManagerId] = useState(
    BASE_MANAGERS[0].id as string
  );
  const [isInvitingManager, setIsInvitingManager] = useState(false);
  const [inviteManagerError, setInviteManagerError] = useState("");
  const [removingInvitedManagerId, setRemovingInvitedManagerId] = useState("");
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isCreatingClientDialog, setIsCreatingClientDialog] = useState(false);
  const [selectedTransferManagerId, setSelectedTransferManagerId] = useState(
    BASE_MANAGERS[0].id as string
  );
  const [isTransferringDialog, setIsTransferringDialog] = useState(false);
  const [transferDialogError, setTransferDialogError] = useState("");
  const [currentTimeMs, setCurrentTimeMs] = useState<number | null>(null);
  const [toast, setToast] = useState<UiToast | null>(null);
  const [supplierPresenceRecords, setSupplierPresenceRecords] = useState<
    SupplierPresenceRecord[]
  >([]);
  const [resolvedHighlight, setResolvedHighlight] = useState<{
    ticketId: string;
    until: number;
  } | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [editTarget, setEditTarget] = useState<EditMeta | null>(null);
  const [hoveredMessageId, setHoveredMessageId] = useState("");
  const [hoveredEditMessageId, setHoveredEditMessageId] = useState("");
  const [replyMap, setReplyMap] = useState<Record<string, ReplyMeta>>({});
  const [highlightedReplyMessageId, setHighlightedReplyMessageId] = useState("");
  const [isClientTyping, setIsClientTyping] = useState(false);
  const [clientTypingPreview, setClientTypingPreview] = useState("");
  const [deepLinkTicketId, setDeepLinkTicketId] = useState("");
  const [createClientTradePointName, setCreateClientTradePointName] = useState("");
  const [createClientEmail, setCreateClientEmail] = useState("");
  const [createClientPhone, setCreateClientPhone] = useState("");
  const [createClientError, setCreateClientError] = useState("");
  const [notificationCandidates, setNotificationCandidates] = useState<NotificationCandidate[]>([]);
  const [notificationNow, setNotificationNow] = useState(() => Date.now());
  const [dismissedNotificationUntil, setDismissedNotificationUntil] = useState<Record<string, number>>({});
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [pendingClientMessageCount, setPendingClientMessageCount] = useState(0);
  const [ticketContacts, setTicketContacts] = useState<ChatContactItem[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [isSavingContacts, setIsSavingContacts] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const [ticketPageViews, setTicketPageViews] = useState<ChatPageViewItem[]>([]);
  const [currentPageView, setCurrentPageView] = useState<ChatPageViewItem | null>(null);
  const [isLoadingPageViews, setIsLoadingPageViews] = useState(false);
  const [pageViewsError, setPageViewsError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const quickRepliesRef = useRef<HTMLDivElement | null>(null);
  const managerMenuRef = useRef<HTMLDivElement | null>(null);
  const chatFiltersRef = useRef<HTMLDivElement | null>(null);
  const supplierRequestsFilterRef = useRef<HTMLDivElement | null>(null);
  const managerSuggestionsRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageElementsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightedReplyTimeoutRef = useRef<number | null>(null);
  const replyHoverTimeoutRef = useRef<number | null>(null);
  const lastTypingSentAtRef = useRef(0);
  const managerSuggestionRequestIdRef = useRef(0);
  const lastNotificationAtRef = useRef<Record<string, number>>({});
  const lastNotificationMessageIdRef = useRef<Record<string, string>>({});
  const visibleNotificationTicketIdsRef = useRef<Set<string>>(new Set());
  const titleFlashIntervalRef = useRef<number | null>(null);
  const defaultDocumentTitleRef = useRef("TouchSpace");
  const managerIsNearBottomRef = useRef(true);
  const previousActiveChatIdRef = useRef("");
  const previousActiveChatMessageCountRef = useRef(0);
  const supplierAvailabilityByScopeRef = useRef<Record<string, boolean>>({});

  const activeChat = chatData.find((chat) => chat.id === activeChatId);
  const normalizedChatSearchQuery = chatSearchQuery.trim().toLowerCase();
  const chatSearchMatchIds =
    activeChat && normalizedChatSearchQuery
      ? activeChat.messages
          .filter((message) => {
            const searchableText = [
              message.text,
              message.replyToContent,
              message.senderName,
              message.subject,
              message.toEmail,
              message.fromEmail,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();

            return searchableText.includes(normalizedChatSearchQuery);
          })
          .map((message) => message.id)
      : [];
  const normalizedActiveChatSearchMatchIndex =
    chatSearchMatchIds.length > 0
      ? ((activeChatSearchMatchIndex % chatSearchMatchIds.length) +
          chatSearchMatchIds.length) %
        chatSearchMatchIds.length
      : -1;
  const currentChatSearchMatchId =
    normalizedActiveChatSearchMatchIndex >= 0
      ? chatSearchMatchIds[normalizedActiveChatSearchMatchIndex]
      : null;
  const chatSearchMatchIdSet = new Set(chatSearchMatchIds);
  const isActiveDirectSupplierDialog =
    activeChat?.conversationMode === "direct_supplier";
  const activeSupplierRequest =
    activeChat?.supplierRequests.find(
      (request) => !["closed", "cancelled", "resolved"].includes(request.status)
    ) ?? null;
  const hasOpenSupplierRequest = Boolean(
    activeChat?.supplierRequests.some(
      (request) =>
        !["closed", "cancelled", "resolved"].includes(request.status)
    )
  );
  const isActiveSupplierRequestPaused = Boolean(activeSupplierRequest?.supplierSyncPaused);
  const shouldShowSupplierResumePrompt =
    Boolean(activeSupplierRequest?.supplierSyncAwaitingManager) &&
    (!activeSupplierRequest?.supplierSyncManagerPromptAvailableAt ||
      new Date(activeSupplierRequest.supplierSyncManagerPromptAvailableAt).getTime() <=
        (currentTimeMs ?? Date.now()));
  const resolvedTicketEmail =
    ticketContacts.find((contact) => contact.type === "email")?.value?.trim() ||
    activeChat?.canonicalEmail?.trim() ||
    activeChat?.clientEmail?.trim() ||
    activeChat?.currentUserEmail?.trim() ||
    activeChat?.superuserEmail?.trim() ||
    "";
  const isAllOverview = filter === "all" && !activeChat;
  const currentPageViewAgeMs = currentPageView?.visitedAt
    ? (currentTimeMs ?? Date.now()) - new Date(currentPageView.visitedAt).getTime()
    : null;
  const clientIsOnSite =
    isClientTyping ||
    typeof currentPageViewAgeMs === "number" &&
    Number.isFinite(currentPageViewAgeMs) &&
    currentPageViewAgeMs >= 0 &&
    currentPageViewAgeMs <= CLIENT_ON_SITE_ACTIVITY_TTL_MS;
  const shouldShowClientOfflineHint =
    Boolean(activeChat) &&
    !isActiveDirectSupplierDialog &&
    sendMode === "chat" &&
    !isLoadingPageViews &&
    !pageViewsError &&
    !clientIsOnSite;
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

  const canEditManagerMessage = useCallback(
    (message: ChatMessage) => {
      if (
        message.from !== "manager" ||
        message.senderProfileId !== currentManagerId ||
        message.messageType !== "text" ||
        message.transport === "email"
      ) {
        return false;
      }

      const now = currentTimeMs ?? Date.now();
      return now - new Date(message.createdAt).getTime() <= 20 * 60 * 1000;
    },
    [currentManagerId, currentTimeMs]
  );

  const startEditingMessage = useCallback((message: ChatMessage) => {
    setEditTarget({
      messageId: message.id,
      originalText: message.text,
    });
    setReplyTarget(null);
    setSelectedFiles([]);
    setAttachmentName("");
    setSendMode("chat");
    setMessageText(message.text);
    composerTextareaRef.current?.focus();
  }, []);

  const cancelEditingMessage = useCallback(() => {
    setEditTarget(null);
    setMessageText("");
  }, []);

  const managerEmptyState =
    filter === "incoming"
      ? {
          imageSrc: "/icons/vhodyshie.webp",
          title: "Входящие обращения",
          description:
            'Все новые сообщения, которые никто не взял в работу, отображаются во вкладке "Входящие".',
        }
      : filter === "in_progress"
        ? {
            imageSrc: "/icons/moi.webp",
            title: "Мои диалоги",
            description:
              'Во вкладке "Мои" отображаются только активные диалоги, закреплённые за вами.',
          }
        : {
            imageSrc: "/icons/moi.webp",
            title: "Все обращения",
            description:
              "Здесь можно быстро открыть любой диалог из общей очереди и истории работы.",
          };
  const availableManagers = dedupeManagers(
    (
      managerPresenceRecords.length > 0
        ? managerPresenceRecords.map((manager) => ({
            id: manager.id,
            name: manager.fullName,
            status: manager.status,
          }))
        : BASE_MANAGERS.map((manager) => ({
            ...manager,
            status: managerStatuses[manager.id] ?? "offline",
          }))
    ).map((manager) => ({
      ...manager,
      status:
        manager.id === currentManagerId
          ? currentManagerStatus
          : manager.status,
    }))
  );
  const filteredQuickReplies = quickReplies.filter((phrase) =>
    phrase.toLowerCase().includes(quickReplySearch.trim().toLowerCase())
  );
  const isManagerSuggestionsOpen =
    managerSuggestions.length > 0 &&
    messageText.replace(/\s+/g, " ").trim().length >= 2 &&
    !showQuickReplies &&
    !showEmojiPicker;

  const applyManagerSuggestion = useCallback((text: string) => {
    setMessageText(text);
    setManagerSuggestions([]);
    setActiveManagerSuggestionIndex(-1);

    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
      const cursorPosition = text.length;
      composerTextareaRef.current?.setSelectionRange(cursorPosition, cursorPosition);
    });
  }, []);

  const showDesktopNotification = async (
    title: string,
    body: string,
    options?: {
      tag?: string;
      ticketId?: string;
      messageId?: string;
      scopeStatus?: string;
      subtitle?: string | null;
      metaLabel?: string | null;
      primaryLabel?: string;
      secondaryLabel?: string;
      avatarEmoji?: string | null;
      avatarColor?: string | null;
      tone?: "blue" | "green" | "amber";
    }
  ) => {
    const targetUrl =
      options?.ticketId ? `/?ticket=${options.ticketId}` : activeChatId ? `/?ticket=${activeChatId}` : "/";

    if (isDesktopShell()) {
      if (!shouldShowDesktopBackgroundNotification()) {
        return;
      }

      await showDesktopShellNotification({
        title,
        body,
        url: targetUrl,
        ticketId: options?.ticketId,
        scopeStatus: options?.scopeStatus,
        messageId: options?.messageId,
        subtitle: options?.subtitle ?? null,
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
          tag: `manager-ui-${options?.tag ?? title}`,
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

  const readReplyMap = (ticketId: string) => {
    if (typeof window === "undefined") {
      return {} as Record<string, ReplyMeta>;
    }

    const rawValue = window.localStorage.getItem(managerReplyMapStorageKey);

    if (!rawValue) {
      return {} as Record<string, ReplyMeta>;
    }

    try {
      const parsed = JSON.parse(rawValue) as Record<string, Record<string, ReplyMeta>>;
      return parsed[ticketId] ?? {};
    } catch {
      window.localStorage.removeItem(managerReplyMapStorageKey);
      return {} as Record<string, ReplyMeta>;
    }
  };

  const writeReplyMap = (ticketId: string, nextReplyMap: Record<string, ReplyMeta>) => {
    if (typeof window === "undefined") {
      return;
    }

    const rawValue = window.localStorage.getItem(managerReplyMapStorageKey);
    const parsed = rawValue
      ? (JSON.parse(rawValue) as Record<string, Record<string, ReplyMeta>>)
      : {};

    parsed[ticketId] = nextReplyMap;
    window.localStorage.setItem(managerReplyMapStorageKey, JSON.stringify(parsed));
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setDeepLinkTicketId(params.get("ticket") ?? "");
  }, []);

  useEffect(() => {
    const session = readAuthSession();

    if (!session) {
      router.replace("/login");
      return;
    }

    if (session.role !== "manager") {
      router.replace(getHomePathForRole(session.role));
      return;
    }

    const fallbackManager =
      managerAccounts.find((account) => account.id === session.managerId) ??
      managerAccounts.find((account) => account.login === session.login) ??
      managerAccounts[0] ??
      { id: "manager", name: "Менеджер" };
    const nextManagerId = session.managerId ?? fallbackManager.id;
    const nextManagerName = resolveManagerSessionName(
      session.managerName,
      session.fullName,
      fallbackManager.name
    );

    if (session.managerId !== nextManagerId || session.managerName !== nextManagerName) {
      writeAuthSession({
        ...session,
        managerId: nextManagerId,
        managerName: nextManagerName,
      });
    }

    setCurrentManagerId(nextManagerId);
    setCurrentManagerName(nextManagerName);
    setManagerStatuses({});
    setManagerPresenceRecords([]);
    setCurrentManagerStatus("online");
    setAuthReady(true);
  }, [router]);

  const fetchMessages = async (
    ticketId: string,
    markAsRead = false
  ): Promise<ApiMessage[]> => {
    const response = await fetch(
      apiUrl(
        `/tickets/${ticketId}/messages?viewerType=manager&viewerId=${encodeURIComponent(
          currentManagerId
        )}&markAsRead=${markAsRead ? "true" : "false"}`
      )
    );
    if (!response.ok) {
      throw new Error("Не удалось загрузить сообщения");
    }
    return response.json();
  };

  const fetchTickets = async (): Promise<ApiTicket[]> => {
    const [ticketsResponse, directDialogsResponse] = await Promise.all([
      fetch(
        apiUrl(
          `/tickets?viewerType=manager&viewerId=${encodeURIComponent(currentManagerId)}`
        )
      ),
      fetch(
        apiUrl(
          `/tickets/manager-supplier-dialogs?managerId=${encodeURIComponent(
            currentManagerId
          )}&managerName=${encodeURIComponent(currentManagerName)}`
        )
      ),
    ]);

    if (!ticketsResponse.ok) {
      throw new Error("Не удалось загрузить тикеты");
    }

    const tickets = (await ticketsResponse.json()) as ApiTicket[];
    const directDialogs = directDialogsResponse.ok
      ? ((await directDialogsResponse.json()) as ApiTicket[])
      : [];

    return [...tickets, ...directDialogs].filter(
      (ticket, index, items) => items.findIndex((item) => item.id === ticket.id) === index
    );
  };

  const fetchManagerNotificationCandidates = async (
    managerProfileId = currentManagerId
  ): Promise<NotificationCandidate[]> => {
    const response = await fetch(
      apiUrl(
        `/notifications/manager-candidates?profileId=${encodeURIComponent(managerProfileId)}`
      )
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить кандидатов для уведомлений");
    }

    const payload = (await response.json()) as { items?: NotificationCandidate[] };
    return Array.isArray(payload.items) ? payload.items : [];
  };

  const refreshNotificationCandidates = useCallback(async () => {
    if (!currentManagerId) {
      return;
    }

    try {
      const notificationManagerId = resolveManagerProfileId(
        currentManagerId,
        currentManagerName,
        managerPresenceRecords
      );
      const candidates = await fetchManagerNotificationCandidates(notificationManagerId);
      setNotificationCandidates(candidates);
    } catch (error) {
      console.error("Ошибка загрузки кандидатов для уведомлений:", error);
    }
  }, [currentManagerId, currentManagerName, managerPresenceRecords]);

  const syncMessagesForTickets = useCallback(
    async (ticketIds: string[]) => {
      const messageResults = await Promise.all(
        ticketIds.map(async (ticketId) => {
          try {
            const messages = await fetchMessages(ticketId, false);
            return { ticketId, messages };
          } catch (error) {
            console.error(`Ошибка загрузки сообщений тикета ${ticketId}:`, error);
            return null;
          }
        })
      );

      messageResults.forEach((result) => {
        if (!result) {
          return;
        }

        applyMessagesToTicket(result.ticketId, result.messages);
      });
    },
    [currentManagerId]
  );

  const syncTickets = (tickets: ApiTicket[]) => {
    const formattedChats = tickets.map(formatTicket);

    setChatData((prevChats) =>
      formattedChats.map((formattedChat) => {
        const existingChat = prevChats.find((chat) => chat.id === formattedChat.id);

        if (!existingChat) {
          return formattedChat;
        }

        return {
          ...formattedChat,
          messages: existingChat.messages,
          supplierRequests: existingChat.supplierRequests,
        };
      })
    );

    if (formattedChats.length === 0) {
      setActiveChatId("");
      return;
    }

    setActiveChatId((currentActiveChatId) => {
      if (
        currentActiveChatId &&
        formattedChats.some((chat) => chat.id === currentActiveChatId)
      ) {
        return currentActiveChatId;
      }

      if (isChatPaneDismissed) {
        return "";
      }

      return formattedChats[0].id;
    });
  };

  const fetchSupplierRequests = async (
    ticketId: string
  ): Promise<ApiSupplierRequest[]> => {
    const response = await fetch(apiUrl(`/tickets/${ticketId}/supplier-requests`));
    if (!response.ok) {
      throw new Error("Не удалось загрузить запросы поставщику");
    }
    return response.json();
  };

  const fetchTicketContacts = async (ticketId: string): Promise<ChatContactItem[]> => {
    const response = await fetch(
      apiUrl(
        `/tickets/${ticketId}/contacts?viewerType=manager&viewerId=${encodeURIComponent(
          currentManagerId
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
        `/tickets/${ticketId}/page-views?viewerType=manager&viewerId=${encodeURIComponent(
          currentManagerId
        )}`
      )
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить историю страниц");
    }

    return (await response.json()) as ApiTicketPageViewsResponse;
  };

  const fetchSupplierCompanies = async (): Promise<SupplierCompanyOption[]> => {
    const response = await fetch(apiUrl("/supervisors/supplier-companies"), {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Не удалось загрузить компании поставщиков");
    }

    const payload = (await response.json()) as { items?: SupplierCompanyOption[] };
    return Array.isArray(payload.items) ? payload.items : [];
  };

  const fetchTyping = async (
    ticketId: string
  ): Promise<{
    clientTyping: boolean;
    managerTyping: boolean;
    clientPreviewText: string;
  }> => {
    const response = await fetch(
      apiUrl(`/tickets/${ticketId}/typing?_ts=${Date.now()}`),
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить typing-состояние");
    }

    return response.json();
  };

  const sendTyping = async (ticketId: string) => {
    await fetch(apiUrl(`/tickets/${ticketId}/typing`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        senderType: "manager",
      }),
    });
  };

  const emitManagerTyping = (ticketId: string) => {
    const now = Date.now();

    if (now - lastTypingSentAtRef.current < 900) {
      return;
    }

    lastTypingSentAtRef.current = now;

    void sendTyping(ticketId).catch((typingError) => {
      console.error("Ошибка отправки typing-события менеджера:", typingError);
    });
  };

  const applyMessagesToTicket = (ticketId: string, messages: ApiMessage[]) => {
    setChatData((prevChats) =>
      prevChats.map((chat) =>
        chat.id === ticketId
          ? {
              ...chat,
              messages: messages.filter(shouldIncludeManagerChatMessage).map(formatMessage),
            }
          : chat
      )
    );
  };

  const applySupplierRequestsToTicket = (
    ticketId: string,
    supplierRequests: ApiSupplierRequest[]
  ) => {
    setChatData((prevChats) =>
      prevChats.map((chat) =>
        chat.id === ticketId
          ? {
              ...chat,
              supplierRequests: supplierRequests.map(formatSupplierRequest),
            }
          : chat
      )
    );
  };

  const applyTicketUpdate = (updatedTicket: ApiTicket) => {
    const formattedChat = formatTicket(updatedTicket);

    setChatData((prevChats) =>
      prevChats.map((chat) =>
        chat.id === updatedTicket.id
          ? {
              ...chat,
              ...formattedChat,
              messages: chat.messages,
              supplierRequests: chat.supplierRequests,
            }
          : chat
      )
    );
  };

  const resolvedCurrentManagerName =
    currentManagerName.trim() ||
    managerAccounts.find((account) => account.id === currentManagerId)?.name ||
    "Менеджер";

  const isChatMine = useCallback(
    (chat: ChatItem) => {
      if (chat.rawStatus === "resolved") {
        return false;
      }

      if (currentManagerId && chat.assignedManagerId === currentManagerId) {
        return true;
      }

      if (
        resolvedCurrentManagerName &&
        chat.assignedManagerName &&
        chat.assignedManagerName === resolvedCurrentManagerName &&
        !chat.assignedManagerId
      ) {
        return true;
      }

      if (currentManagerId && chat.invitedManagerIds.includes(currentManagerId)) {
        return true;
      }

      return false;
    },
    [currentManagerId, resolvedCurrentManagerName]
  );

  const resolveManagerName = useCallback(
    (managerId?: string | null, managerName?: string | null) => {
      const normalizedManagerName = managerName?.trim();

      if (normalizedManagerName && isSpecificManagerName(normalizedManagerName)) {
        return normalizedManagerName;
      }

      if (managerId && managerId === currentManagerId) {
        return resolvedCurrentManagerName;
      }

      return (
        availableManagers.find((manager) => manager.id === managerId)?.name ||
        managerAccounts.find((manager) => manager.id === managerId)?.name ||
        managerName?.trim() ||
        "Менеджер"
      );
    },
    [availableManagers, currentManagerId, resolvedCurrentManagerName]
  );

  const isPrimaryManagerOfChat = useCallback(
    (chat: ChatItem | null) => {
      if (!chat || chat.rawStatus === "resolved" || chat.conversationMode === "direct_supplier") {
        return false;
      }

      if (currentManagerId && chat.assignedManagerId === currentManagerId) {
        return true;
      }

      if (
        chat.assignedManagerName &&
        isSpecificManagerName(resolveManagerName(chat.assignedManagerId, chat.assignedManagerName)) &&
        resolveManagerName(chat.assignedManagerId, chat.assignedManagerName) === resolvedCurrentManagerName
      ) {
        return true;
      }

      return (
        !chat.assignedManagerId &&
        Boolean(chat.assignedManagerName) &&
        resolveManagerName(null, chat.assignedManagerName) === resolvedCurrentManagerName
      );
    },
    [currentManagerId, resolvedCurrentManagerName, resolveManagerName]
  );

  const canManageActiveChatManagers = isPrimaryManagerOfChat(activeChat ?? null);
  const activeChatInvitedManagers = activeChat
    ? activeChat.invitedManagerIds.map((managerId, index) => ({
        id: managerId,
        name: resolveManagerName(managerId, activeChat.invitedManagerNames[index]),
      }))
    : [];
  const inviteManagerOptions = activeChat
    ? availableManagers.filter(
        (manager) =>
          manager.id !== currentManagerId &&
          manager.id !== activeChat.assignedManagerId &&
          !activeChat.invitedManagerIds.includes(manager.id)
      )
    : availableManagers;
  const transferManagerOptions = availableManagers.filter(
    (manager) => manager.id !== currentManagerId
  );
  const firstOnlineInviteManagerId =
    inviteManagerOptions.find((manager) => manager.status === "online")?.id ??
    inviteManagerOptions[0]?.id ??
    "";
  const firstOnlineTransferManagerId =
    transferManagerOptions.find((manager) => manager.status === "online")?.id ??
    transferManagerOptions[0]?.id ??
    "";

  const canCurrentManagerWriteToChat = useCallback(
    (chat: ChatItem | null) => {
      if (!chat || chat.rawStatus === "resolved") {
        return false;
      }

      if (!chat.assignedManagerId) {
        return true;
      }

      if (currentManagerId && chat.assignedManagerId === currentManagerId) {
        return true;
      }

      if (currentManagerId && chat.invitedManagerIds.includes(currentManagerId)) {
        return true;
      }

      return false;
    },
    [currentManagerId]
  );

  const filteredChats = chatData.filter((chat) => {
    const isDirectSupplierDialog = chat.conversationMode === "direct_supplier";

    if (filter === "supplier") {
      return isDirectSupplierDialog;
    }

    if (isDirectSupplierDialog) {
      return false;
    }

    if (filter === "all") return true;

    if (filter === "in_progress") {
      return isChatMine(chat) && !chat.aiEnabled;
    }

    return (
      chat.rawStatus === "new" &&
      !chat.assignedManagerId &&
      !chat.aiEnabled
    );
  });

  const chatFilterActiveCount =
    (chatStatusFilter !== "all" ? 1 : 0) +
    ((chatDateFilterMode === "day" && chatDateFilterDay) ||
    (chatDateFilterMode === "period" && (chatDateFilterFrom || chatDateFilterTo))
      ? 1
      : 0);

  const searchedChats = filteredChats.filter((chat) => {
    if (chatStatusFilter !== "all" && chat.rawStatus !== chatStatusFilter) {
      return false;
    }

    if (
      (chatDateFilterMode === "day" && chatDateFilterDay) ||
      (chatDateFilterMode === "period" && (chatDateFilterFrom || chatDateFilterTo))
    ) {
      const activityAt =
        chat.lastMessageAt ??
        getLastNonSystemMessage(chat)?.createdAt ??
        chat.resolvedAt ??
        null;

      if (!activityAt) {
        return false;
      }

      const activityDay = getDateInputValue(activityAt);

      if (chatDateFilterMode === "day") {
        if (activityDay !== chatDateFilterDay) {
          return false;
        }
      } else {
        if (chatDateFilterFrom && activityDay < chatDateFilterFrom) {
          return false;
        }

        if (chatDateFilterTo && activityDay > chatDateFilterTo) {
          return false;
        }
      }
    }

    const normalizedQuery = searchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return true;
    }

    const searchHaystack = [
      chat.title,
      chat.clientId ?? "",
      chat.clientName,
      chat.canonicalEmail ?? "",
      chat.clientEmail ?? "",
      chat.currentUserEmail ?? "",
      chat.superuserEmail ?? "",
      chat.clientPhone ?? "",
      chat.currentUserPhone ?? "",
      chat.superuserPhone ?? "",
      chat.assignedManagerName ?? "",
      chat.lastResolvedByManagerName ?? "",
      chat.invitedManagerNames.join(" "),
      ...chat.messages.map((message) => message.text),
    ]
      .join(" ")
      .toLowerCase();

    return searchHaystack.includes(normalizedQuery);
  });

  const incomingUnreadCount = chatData
    .filter((chat) => chat.rawStatus === "new" && !chat.assignedManagerId && !chat.aiEnabled)
    .reduce((total, chat) => total + getUnreadCount(chat), 0);

  const myUnreadCount = chatData
    .filter((chat) => isChatMine(chat) && !chat.aiEnabled)
    .reduce((total, chat) => total + getUnreadCount(chat), 0);
  const actionableNotificationCandidates = notificationCandidates.filter(
    (candidate) => candidate.scopeStatus !== "claimed_by_other_recently"
  );
  const incomingNotificationCount = actionableNotificationCandidates.filter(
    (candidate) =>
      candidate.conversationMode !== "direct_supplier" &&
      candidate.scopeStatus !== "owned_active"
  ).length;
  const myNotificationCount = actionableNotificationCandidates.filter(
    (candidate) =>
      candidate.conversationMode !== "direct_supplier" &&
      candidate.scopeStatus === "owned_active"
  ).length;
  const supplierNotificationCount = actionableNotificationCandidates.filter(
    (candidate) => candidate.conversationMode === "direct_supplier"
  ).length;
  const supplierUnreadCount = chatData
    .filter((chat) => chat.conversationMode === "direct_supplier")
    .reduce((total, chat) => total + getUnreadCount(chat), 0);
  const allUnreadCount = chatData
    .filter((chat) => chat.conversationMode !== "direct_supplier")
    .reduce((total, chat) => total + getUnreadCount(chat), 0);
  const incomingTabBadgeCount = Math.max(incomingUnreadCount, incomingNotificationCount);
  const myTabBadgeCount = Math.max(myUnreadCount, myNotificationCount);
  const supplierTabBadgeCount = Math.max(supplierUnreadCount, supplierNotificationCount);
  const allTabBadgeCount = Math.max(
    allUnreadCount,
    incomingNotificationCount + myNotificationCount
  );

  const getManagerDisplayName = useCallback(
    (chat: ChatItem) =>
      chat.assignedManagerName?.trim() ||
      chat.lastResolvedByManagerName?.trim() ||
      (isChatMine(chat) ? resolvedCurrentManagerName : "") ||
      "Не назначен",
    [resolvedCurrentManagerName, isChatMine]
  );
  const onlineManagers = dedupeManagers(
    availableManagers.filter((manager) => manager.status === "online")
  );
  const isSupplierScopeOnline = useCallback(
    (supplierScopeId?: string | null) =>
      supplierPresenceRecords.some(
        (supplier) =>
          supplier.supplierId === (supplierScopeId?.trim() || null) &&
          supplier.status === "online"
      ),
    [supplierPresenceRecords]
  );
  const getSupplierPresenceContactName = useCallback(
    (
      chat?: Pick<
        ChatItem,
        "supplierId" | "supplierCompanyName" | "supplierName" | "clientName" | "title"
      > | null
    ) => {
      const supplierScopeId = chat?.supplierId?.trim();
      const supplierCompanyName = getDirectSupplierCompanyName(chat).trim().toLowerCase();
      const matchingSuppliers = supplierPresenceRecords.filter((record) => {
        const recordSupplierId = record.supplierId?.trim();
        const recordCompanyName = record.companyName?.trim().toLowerCase();

        return (
          (supplierScopeId &&
            (recordSupplierId === supplierScopeId || record.id.trim() === supplierScopeId)) ||
          (recordCompanyName && recordCompanyName === supplierCompanyName)
        );
      });
      const supplier =
        matchingSuppliers.find(
          (record) => record.fullName.trim().toLowerCase() !== supplierCompanyName
        ) ?? matchingSuppliers[0];
      const fullName = supplier?.fullName?.trim();

      return fullName && fullName.toLowerCase() !== supplierCompanyName ? fullName : null;
    },
    [supplierPresenceRecords]
  );
  const getDirectSupplierDisplayNameForChat = useCallback(
    (
      chat?: Pick<
        ChatItem,
        | "supplierId"
        | "supplierCompanyName"
        | "supplierName"
        | "supplierContactName"
        | "clientName"
        | "title"
      > | null
    ) => {
      const companyName = getDirectSupplierCompanyName(chat);
      const contactName = getDirectSupplierContactName(chat) || getSupplierPresenceContactName(chat);

      return contactName ? `${contactName}/${companyName}` : companyName;
    },
    [getSupplierPresenceContactName]
  );
  const getChatDisplayName = useCallback(
    (chat?: ChatItem | null) =>
      chat?.conversationMode === "direct_supplier"
        ? getDirectSupplierDisplayNameForChat(chat)
        : getChatClientDisplayName(chat),
    [getDirectSupplierDisplayNameForChat]
  );
  const getDirectSupplierMessageDisplayNameForChat = useCallback(
    (chat: ChatItem | null, senderName?: string | null) => {
      const companyName = getDirectSupplierCompanyName(chat);
      const normalizedCompanyName = companyName.trim().toLowerCase();
      const normalizedSenderName = senderName?.trim();
      const contactName =
        normalizedSenderName &&
        normalizedSenderName.toLowerCase() !== normalizedCompanyName &&
        normalizedSenderName.toLowerCase() !== "поставщик"
          ? normalizedSenderName
          : getDirectSupplierContactName(chat) || getSupplierPresenceContactName(chat);

      return contactName ? `${contactName}/${companyName}` : companyName;
    },
    [getSupplierPresenceContactName]
  );
  const getDirectSupplierNotificationTitle = useCallback(
    (candidate: Pick<NotificationCandidate, "title" | "tradePointName" | "clientName">) => {
      const companyName =
        candidate.tradePointName?.trim() ||
        candidate.title?.trim() ||
        candidate.clientName?.trim() ||
        "Поставщик";
      const contactName = getSupplierPresenceContactName({
        supplierId: null,
        supplierCompanyName: companyName,
        supplierName: companyName,
        clientName: companyName,
        title: companyName,
      });

      return contactName ? `${contactName}/${companyName}` : companyName;
    },
    [getSupplierPresenceContactName]
  );
  const activeChatSupplierScopeIds = Array.from(
    new Set(
      (activeChat?.supplierRequests ?? [])
        .filter((request) => !["closed", "cancelled", "resolved"].includes(request.status))
        .map((request) => request.supplierId?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
  const availableSupplierRequestSuppliers = Array.from(
    new Set((activeChat?.supplierRequests ?? []).map((request) => request.supplierName))
  );
  const selectedSupplierOption =
    supplierCompanies.find((item) => item.companyName === selectedSupplier) ?? null;
  const availableSupplierRequestStatuses = Array.from(
    new Set((activeChat?.supplierRequests ?? []).map((request) => request.status))
  );
  const supplierRequestActiveFilterCount = [
    supplierRequestSupplierFilter !== "all",
    supplierRequestStatusFilter !== "all",
    supplierRequestPeriodFilter !== "all",
  ].filter(Boolean).length;
  const filteredSupplierRequests = (activeChat?.supplierRequests ?? []).filter((request) => {
    const matchesSupplier =
      supplierRequestSupplierFilter === "all" ||
      request.supplierName === supplierRequestSupplierFilter;
    const matchesStatus =
      supplierRequestStatusFilter === "all" ||
      request.status === supplierRequestStatusFilter;
    const matchesPeriod = matchesSupplierRequestPeriod(
      request.createdAtRaw,
      supplierRequestPeriodFilter
    );

    return matchesSupplier && matchesStatus && matchesPeriod;
  });

  const scrollManagerChatToBottom = (behavior: ScrollBehavior = "smooth") => {
    const viewport = messagesViewportRef.current;

    if (viewport) {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior,
      });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    }

    managerIsNearBottomRef.current = true;
    setShowScrollToLatest(false);
    setPendingClientMessageCount(0);
  };

  const updateManagerScrollState = useCallback(() => {
    const viewport = messagesViewportRef.current;

    if (!viewport) {
      return;
    }

    const distanceToBottom =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const isNearBottom = distanceToBottom < 96;

    managerIsNearBottomRef.current = isNearBottom;

    if (isNearBottom) {
      setShowScrollToLatest(false);
      setPendingClientMessageCount(0);
      return;
    }

    setShowScrollToLatest(true);
  }, []);

  useEffect(() => {
    if (!authReady || !currentManagerId) {
      return;
    }

    const loadInitialTickets = async () => {
      try {
        const [
          data,
          remoteStatuses,
          remoteManagerRecords,
          supplierStatuses,
          nextSupplierCompanies,
        ] =
          await Promise.all([
          fetchTickets(),
          fetchManagerStatuses().catch(
            (): Record<string, ManagerPresence> => ({})
          ),
          fetchManagerStatusRecords().catch((): ManagerPresenceRecord[] => []),
          fetchSupplierStatusRecords().catch((): SupplierPresenceRecord[] => []),
          fetchSupplierCompanies().catch((): SupplierCompanyOption[] => []),
        ]);
        const notificationManagerId = resolveManagerProfileId(
          currentManagerId,
          currentManagerName,
          remoteManagerRecords
        );
        const candidates = await fetchManagerNotificationCandidates(notificationManagerId).catch(
          (): NotificationCandidate[] => []
        );

        setManagerStatuses(remoteStatuses);
        setManagerPresenceRecords(remoteManagerRecords);
        setSupplierPresenceRecords(supplierStatuses);
        setCurrentManagerStatus(remoteStatuses[currentManagerId] ?? "online");
        setNotificationCandidates(candidates);
        setSupplierCompanies(nextSupplierCompanies);
        setSupplierCompaniesError("");
        setSelectedSupplier((currentValue) => {
          if (
            currentValue &&
            nextSupplierCompanies.some((item) => item.companyName === currentValue)
          ) {
            return currentValue;
          }

          return nextSupplierCompanies[0]?.companyName ?? "";
        });
        syncTickets(data);
        const initialTicketId =
          (!isChatPaneDismissed &&
            (data.some((ticket) => ticket.id === deepLinkTicketId)
              ? deepLinkTicketId
              : data[0]?.id)) ||
          "";

        if (initialTicketId) {
          try {
            const messages = await fetchMessages(initialTicketId, true);
            applyMessagesToTicket(initialTicketId, messages);
          } catch (error) {
            console.error(`Ошибка загрузки сообщений активного тикета ${initialTicketId}:`, error);
          }
        }

        void syncMessagesForTickets(
          data.map((ticket) => ticket.id).filter((ticketId) => ticketId !== initialTicketId)
        );
      } catch (error) {
        console.error("Ошибка загрузки тикетов:", error);
      }
    };

    void loadInitialTickets();
  }, [
    authReady,
    currentManagerId,
    currentManagerName,
    deepLinkTicketId,
    isChatPaneDismissed,
    syncMessagesForTickets,
  ]);

  useEffect(() => {
    if (!deepLinkTicketId || chatData.length === 0 || isChatPaneDismissed) {
      return;
    }

    if (chatData.some((chat) => chat.id === deepLinkTicketId)) {
      setIsChatPaneDismissed(false);
      setActiveChatId(deepLinkTicketId);
    }
  }, [deepLinkTicketId, chatData, isChatPaneDismissed]);

  useEffect(() => {
    if (!authReady) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const refreshManagerData = async () => {
        try {
          const [tickets, remoteStatuses, remoteManagerRecords, supplierStatuses] =
            await Promise.all([
            fetchTickets(),
            fetchManagerStatuses().catch(
              (): Record<string, ManagerPresence> => ({})
            ),
            fetchManagerStatusRecords().catch((): ManagerPresenceRecord[] => []),
            fetchSupplierStatusRecords().catch((): SupplierPresenceRecord[] => []),
          ]);
          const notificationManagerId = resolveManagerProfileId(
            currentManagerId,
            currentManagerName,
            remoteManagerRecords
          );
          const candidates = await fetchManagerNotificationCandidates(notificationManagerId).catch(
            (): NotificationCandidate[] => []
          );

          setManagerStatuses(remoteStatuses);
          setManagerPresenceRecords(remoteManagerRecords);
          setSupplierPresenceRecords(supplierStatuses);
          setNotificationCandidates(candidates);
          if (currentManagerId) {
            setCurrentManagerStatus(remoteStatuses[currentManagerId] ?? "online");
          }
          syncTickets(tickets);

          await syncMessagesForTickets(tickets.map((ticket) => ticket.id));

          if (!activeChatId) {
            return;
          }

          const supplierRequests = await fetchSupplierRequests(activeChatId);
          applySupplierRequestsToTicket(activeChatId, supplierRequests);
        } catch (pollingError) {
          console.error("Ошибка polling manager page:", pollingError);
        }
      };

      void refreshManagerData();
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [authReady, activeChatId, currentManagerId, currentManagerName, syncMessagesForTickets]);

  useEffect(() => {
    if (!authReady || !currentManagerId || !currentManagerName) {
      return;
    }

    void updateManagerPresence(currentManagerId, currentManagerName, currentManagerStatus)
      .then(async () => {
        setManagerStatuses((prev) => ({
          ...prev,
          [currentManagerId]: currentManagerStatus,
        }));

        if (currentManagerStatus !== "online") {
          return;
        }

        const notificationManagerId = resolveManagerProfileId(
          currentManagerId,
          currentManagerName,
          managerPresenceRecords
        );
        const [tickets, candidates] = await Promise.all([
          fetchTickets().catch((): ApiTicket[] => []),
          fetchManagerNotificationCandidates(notificationManagerId).catch(
            (): NotificationCandidate[] => []
          ),
        ]);

        if (tickets.length > 0) {
          syncTickets(tickets);
          await syncMessagesForTickets(tickets.map((ticket) => ticket.id));
        }

        setNotificationCandidates(candidates);
      })
      .catch((error) => {
        console.error("Ошибка синхронизации статуса менеджера:", error);
      });
  }, [
    authReady,
    currentManagerId,
    currentManagerName,
    currentManagerStatus,
    managerPresenceRecords,
    syncMessagesForTickets,
  ]);

  useEffect(() => {
    if (!authReady || activeChatSupplierScopeIds.length === 0) {
      supplierAvailabilityByScopeRef.current = {};
      return;
    }

    const nextAvailabilityMap = Object.fromEntries(
      activeChatSupplierScopeIds.map((scopeId) => [scopeId, isSupplierScopeOnline(scopeId)])
    );
    const previousAvailabilityMap = supplierAvailabilityByScopeRef.current;

    for (const scopeId of activeChatSupplierScopeIds) {
      const previousValue = previousAvailabilityMap[scopeId];
      const nextValue = nextAvailabilityMap[scopeId];
      const relatedRequest = (activeChat?.supplierRequests ?? []).find(
        (request) =>
          request.supplierId === scopeId &&
          !["closed", "cancelled", "resolved"].includes(request.status)
      );
      const supplierLabel = relatedRequest?.supplierName?.trim() || "Поставщик";

      if (previousValue === false && nextValue === true) {
        setToast({
          message: `${supplierLabel} снова в сети`,
          tone: "info",
        });
      }
    }

    supplierAvailabilityByScopeRef.current = nextAvailabilityMap;
  }, [
    activeChat?.supplierRequests,
    activeChatSupplierScopeIds,
    authReady,
    isSupplierScopeOnline,
  ]);

  useEffect(() => {
    if (
      !authReady ||
      !currentManagerId ||
      !currentManagerName ||
      currentManagerStatus === "offline"
    ) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void updateManagerPresence(currentManagerId, currentManagerName, currentManagerStatus).catch(
        (error) => {
          console.error("Ошибка heartbeat статуса менеджера:", error);
        }
      );
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, [authReady, currentManagerId, currentManagerName, currentManagerStatus]);

  useEffect(() => {
    if (!activeChatId) return;

    const loadCurrentMessages = async () => {
      try {
        const messages = await fetchMessages(activeChatId, true);
        applyMessagesToTicket(activeChatId, messages);
      } catch (err) {
        console.error("Ошибка загрузки сообщений:", err);
      }
    };

    void loadCurrentMessages();
  }, [activeChatId]);

  useEffect(() => {
    if (!authReady || !activeChatId || !currentManagerId) {
      setTicketContacts([]);
      setContactsError("");
      return;
    }

    const loadContacts = async () => {
      setIsLoadingContacts(true);
      setContactsError("");

      try {
        const contacts = await fetchTicketContacts(activeChatId);
        setTicketContacts(contacts);
      } catch (error) {
        console.error("Ошибка загрузки контактов:", error);
        setContactsError("Не удалось загрузить контакты");
      } finally {
        setIsLoadingContacts(false);
      }
    };

    void loadContacts();
  }, [authReady, activeChatId, currentManagerId]);

  useEffect(() => {
    setSendMode("chat");
    setEmailRecipient(resolvedTicketEmail);
  }, [activeChatId]);

  useEffect(() => {
    if (!emailRecipient.trim() && resolvedTicketEmail) {
      setEmailRecipient(resolvedTicketEmail);
    }
  }, [resolvedTicketEmail, emailRecipient]);

  useEffect(() => {
    if (!authReady || !activeChatId || !currentManagerId) {
      setTicketPageViews([]);
      setCurrentPageView(null);
      setPageViewsError("");
      return;
    }

    const loadPageViews = async () => {
      setIsLoadingPageViews(true);
      setPageViewsError("");

      try {
        const payload = await fetchTicketPageViews(activeChatId);
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
  }, [authReady, activeChatId, currentManagerId]);

  useEffect(() => {
    if (!activeChatId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchMessages(activeChatId, true)
        .then((messages) => {
          applyMessagesToTicket(activeChatId, messages);
        })
        .catch((error) => {
          console.error("Ошибка live-обновления активного чата:", error);
        });
    }, 1500);

    return () => window.clearInterval(intervalId);
  }, [activeChatId]);

  useEffect(() => {
    if (!authReady || !activeChatId || !currentManagerId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchTicketPageViews(activeChatId)
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
  }, [authReady, activeChatId, currentManagerId]);

  const handleAddContact = async (draft: {
    type: "email" | "phone";
    value: string;
  }) => {
    if (!activeChatId || !currentManagerId || !currentManagerName) {
      return;
    }

    setIsSavingContacts(true);
    setContactsError("");

    try {
      const response = await fetch(apiUrl(`/tickets/${activeChatId}/contacts`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          managerId: currentManagerId,
          managerName: currentManagerName,
          type: draft.type,
          value: draft.value,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось сохранить контакт");
      }

      const payload = (await response.json()) as ApiTicketContactsResponse;
      setTicketContacts(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      console.error("Ошибка добавления контакта:", error);
      setContactsError(
        error instanceof Error ? error.message : "Не удалось сохранить контакт"
      );
      throw error;
    } finally {
      setIsSavingContacts(false);
    }
  };

  const handleUpdateContact = async (
    contactId: string,
    draft: {
      type: "email" | "phone";
      value: string;
    }
  ) => {
    if (!activeChatId || !currentManagerId || !currentManagerName) {
      return;
    }

    setIsSavingContacts(true);
    setContactsError("");

    try {
      const response = await fetch(apiUrl(`/tickets/${activeChatId}/contacts/${contactId}`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          managerId: currentManagerId,
          managerName: currentManagerName,
          type: draft.type,
          value: draft.value,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось обновить контакт");
      }

      const payload = (await response.json()) as ApiTicketContactsResponse;
      setTicketContacts(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      console.error("Ошибка обновления контакта:", error);
      setContactsError(
        error instanceof Error ? error.message : "Не удалось обновить контакт"
      );
      throw error;
    } finally {
      setIsSavingContacts(false);
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!activeChatId || !currentManagerId || !currentManagerName) {
      return;
    }

    setIsSavingContacts(true);
    setContactsError("");

    try {
      const response = await fetch(
        apiUrl(`/tickets/${activeChatId}/contacts/${contactId}/delete`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            managerId: currentManagerId,
            managerName: currentManagerName,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Не удалось удалить контакт");
      }

      const payload = (await response.json()) as ApiTicketContactsResponse;
      setTicketContacts(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      console.error("Ошибка удаления контакта:", error);
      setContactsError(
        error instanceof Error ? error.message : "Не удалось удалить контакт"
      );
    } finally {
      setIsSavingContacts(false);
    }
  };

  useEffect(() => {
    if (!activeChatId) return;

    const loadCurrentSupplierRequests = async () => {
      setIsLoadingSupplierRequests(true);
      setSupplierRequestsError("");

      try {
        const supplierRequests = await fetchSupplierRequests(activeChatId);
        applySupplierRequestsToTicket(activeChatId, supplierRequests);
      } catch (error) {
        console.error("Ошибка загрузки запросов поставщику:", error);
        setSupplierRequestsError("Не удалось загрузить запросы поставщику");
      } finally {
        setIsLoadingSupplierRequests(false);
      }
    };

    void loadCurrentSupplierRequests();
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId) {
      setIsClientTyping(false);
      setClientTypingPreview("");
      return;
    }

    const loadTypingState = async () => {
      try {
        const typingState = await fetchTyping(activeChatId);
        setIsClientTyping(typingState.clientTyping);
        setClientTypingPreview(typingState.clientPreviewText || "");
      } catch (error) {
        console.error("Ошибка загрузки typing-состояния:", error);
        setIsClientTyping(false);
        setClientTypingPreview("");
      }
    };

    void loadTypingState();

    const intervalId = window.setInterval(() => {
      void loadTypingState();
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeChatId]);

  useEffect(() => {
    const currentChatId = activeChatId;
    const currentMessageCount = activeChat?.messages.length ?? 0;
    const chatChanged = previousActiveChatIdRef.current !== currentChatId;

    if (chatChanged) {
      previousActiveChatIdRef.current = currentChatId;
      previousActiveChatMessageCountRef.current = currentMessageCount;
      setShowScrollToLatest(false);
      setPendingClientMessageCount(0);

      if (currentChatId) {
        requestAnimationFrame(() => {
          scrollManagerChatToBottom("auto");
        });
      }

      return;
    }

    const previousMessageCount = previousActiveChatMessageCountRef.current;

    if (currentMessageCount <= previousMessageCount) {
      previousActiveChatMessageCountRef.current = currentMessageCount;
      return;
    }

    const newlyArrivedMessages =
      activeChat?.messages.slice(previousMessageCount, currentMessageCount) ?? [];

    previousActiveChatMessageCountRef.current = currentMessageCount;

    if (managerIsNearBottomRef.current) {
      requestAnimationFrame(() => {
        scrollManagerChatToBottom("smooth");
      });
      return;
    }

    const newClientMessagesCount = newlyArrivedMessages.filter(
      (message) => message.from === "client"
    ).length;

    if (newClientMessagesCount > 0) {
      setPendingClientMessageCount((current) => current + newClientMessagesCount);
      setShowScrollToLatest(true);
    }
  }, [activeChatId, activeChat?.messages.length]);

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
    lastTypingSentAtRef.current = 0;
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId || !messageText.trim()) {
      return;
    }

    emitManagerTyping(activeChatId);

    const intervalId = window.setInterval(() => {
      emitManagerTyping(activeChatId);
    }, 900);

    return () => window.clearInterval(intervalId);
  }, [messageText, activeChatId]);

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

      if (candidate.ticketId === activeChatId) {
        return false;
      }

      if (candidate.scopeStatus !== "claimed_by_other_recently") {
        return true;
      }

      const originalNotificationKey = `ticket:${candidate.ticketId}:${candidate.messageId}`;
      const originalHiddenUntil = dismissedNotificationUntil[originalNotificationKey] ?? 0;

      return (
        visibleNotificationTicketIdsRef.current.has(candidate.ticketId) &&
        originalHiddenUntil <= notificationNow
      );
    })
    .slice(0, 3);

  useEffect(() => {
    visibleNotificationTicketIdsRef.current = new Set(
      visibleFloatingNotifications.map((candidate) => candidate.ticketId)
    );
  }, [visibleFloatingNotifications]);

  const dismissFloatingNotification = (notificationKey: string) => {
    const candidate = notificationCandidates.find((item) => item.notificationKey === notificationKey);

    setDismissedNotificationUntil((current) => ({
      ...current,
      [notificationKey]:
        candidate?.conversationMode === "direct_supplier"
          ? Number.POSITIVE_INFINITY
          : Date.now() + REPEATED_NOTIFICATION_INTERVAL_MS,
    }));
  };

  const handlePrimaryFloatingNotification = async (notificationKey: string) => {
    const candidate = notificationCandidates.find((item) => item.notificationKey === notificationKey);

    if (!candidate) {
      return;
    }

    setIsChatPaneDismissed(false);
    setActiveChatId(candidate.ticketId);
    dismissFloatingNotification(notificationKey);

    if (
      candidate.conversationMode !== "direct_supplier" &&
      (candidate.scopeStatus === "new_unclaimed" ||
        candidate.scopeStatus === "missed_unclaimed" ||
        candidate.scopeStatus === "rescue_queue")
    ) {
      await handleClaimIncoming(candidate.ticketId);
      return;
    }

    setFilter(
      candidate.conversationMode === "direct_supplier"
        ? "supplier"
        : candidate.scopeStatus === "owned_active"
          ? "in_progress"
          : "incoming"
    );
  };

  useEffect(() => {
    if (
      !authReady ||
      isDesktopShell() ||
      typeof window === "undefined" ||
      !("Notification" in window)
    ) {
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

    Object.keys(lastNotificationAtRef.current).forEach((notificationKey) => {
      if (!activeCandidateIds.has(notificationKey)) {
        delete lastNotificationAtRef.current[notificationKey];
        delete lastNotificationMessageIdRef.current[notificationKey];
      }
    });

    notificationCandidates.forEach((candidate) => {
      const isDirectSupplierDialog = candidate.conversationMode === "direct_supplier";
      const isClaimedByOther = candidate.scopeStatus === "claimed_by_other_recently";
      const originalNotificationKey = `ticket:${candidate.ticketId}:${candidate.messageId}`;
      const originalHiddenUntil = dismissedNotificationUntil[originalNotificationKey] ?? 0;
      const isActiveChatVisible =
        candidate.ticketId === activeChatId &&
        document.visibilityState === "visible" &&
        document.hasFocus();

      if (!isClaimedByOther && isActiveChatVisible) {
        return;
      }

      if (
        isClaimedByOther &&
        (!visibleNotificationTicketIdsRef.current.has(candidate.ticketId) ||
          originalHiddenUntil > notificationNow)
      ) {
        return;
      }

      const notificationTitle =
        isClaimedByOther
          ? "Чат уже взят в работу"
          : isDirectSupplierDialog
            ? getDirectSupplierNotificationTitle(candidate)
          : candidate.tradePointName?.trim() ||
            candidate.title ||
            candidate.clientName ||
            "Неизвестная торговая точка";
      const notificationBody =
        candidate.messageText.length > 80
          ? `${candidate.messageText.slice(0, 80)}...`
          : candidate.messageText;
      const notificationSubtitle =
        isClaimedByOther
          ? candidate.assignedManagerName
            ? `Уже ведёт ${candidate.assignedManagerName}`
            : "Чат уже забрал другой менеджер"
          : null;
      const notificationMeta =
        candidate.scopeStatus === "missed_unclaimed"
          ? "Пропущенное сообщение более 10 минут"
          : candidate.scopeStatus === "rescue_queue"
            ? "Чат возвращён в общую очередь"
            : candidate.scopeStatus === "owned_active"
              ? "Новое сообщение в вашем диалоге"
              : candidate.waitSeconds > 0
                ? `Ожидание ${Math.floor(candidate.waitSeconds / 60)} мин ${candidate.waitSeconds % 60} сек`
                : null;
      const notificationPrimaryLabel =
        isClaimedByOther
          ? "Открыть"
          : candidate.scopeStatus === "new_unclaimed" ||
              candidate.scopeStatus === "missed_unclaimed" ||
              candidate.scopeStatus === "rescue_queue"
            ? "Взять в работу"
            : "Ответить";
      const lastNotificationAt = lastNotificationAtRef.current[candidate.notificationKey] ?? 0;
      const lastMessageId = lastNotificationMessageIdRef.current[candidate.notificationKey];
      const shouldNotify =
        lastMessageId !== candidate.messageId ||
        (!isClaimedByOther &&
          !isDirectSupplierDialog &&
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
        messageId: candidate.messageId,
        scopeStatus: candidate.scopeStatus,
        subtitle: notificationSubtitle,
        metaLabel: notificationMeta,
        primaryLabel: notificationPrimaryLabel,
        secondaryLabel: "Позже",
        avatarEmoji: candidate.avatarEmoji,
        avatarColor: candidate.avatarColor,
        tone: isClaimedByOther ? "amber" : isDirectSupplierDialog ? "green" : "blue",
      });
    });
  }, [
    dismissedNotificationUntil,
    notificationCandidates,
    notificationNow,
    authReady,
    activeChatId,
    getDirectSupplierNotificationTitle,
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

    if (actionableNotifications.length === 0) {
      document.title = defaultDocumentTitleRef.current;
      return;
    }

    let showAlertTitle = true;
    const alertTitle = `(${actionableNotifications.length}) Новый чат • TouchSpace`;
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
  }, [notificationCandidates]);

  useEffect(() => {
    if (!showQuickReplies && !showEmojiPicker) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!quickRepliesRef.current) {
        return;
      }

      if (!quickRepliesRef.current.contains(event.target as Node)) {
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
    if (!isManagerMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!managerMenuRef.current) {
        return;
      }

      if (!managerMenuRef.current.contains(event.target as Node)) {
        setIsManagerMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isManagerMenuOpen]);

  useEffect(() => {
    if (!isSupplierRequestsFilterOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!supplierRequestsFilterRef.current) {
        return;
      }

      if (!supplierRequestsFilterRef.current.contains(event.target as Node)) {
        setIsSupplierRequestsFilterOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isSupplierRequestsFilterOpen]);

  useEffect(() => {
    if (!isChatFiltersOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!chatFiltersRef.current) {
        return;
      }

      if (!chatFiltersRef.current.contains(event.target as Node)) {
        setIsChatFiltersOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isChatFiltersOpen]);

  useEffect(() => {
    if (!composerTextareaRef.current) {
      return;
    }

    composerTextareaRef.current.style.height = "0px";
    composerTextareaRef.current.style.height = `${Math.min(
      composerTextareaRef.current.scrollHeight,
      132
    )}px`;
  }, [messageText]);

  useEffect(() => {
    setManagerSuggestions([]);
    setActiveManagerSuggestionIndex(-1);
  }, [activeChatId]);

  useEffect(() => {
    const normalizedQuery = messageText.replace(/\s+/g, " ").trim();

    if (
      !activeChatId ||
      !currentManagerId ||
      normalizedQuery.length < 2 ||
      showQuickReplies ||
      showEmojiPicker
    ) {
      setManagerSuggestions([]);
      setActiveManagerSuggestionIndex(-1);
      return;
    }

    const requestId = managerSuggestionRequestIdRef.current + 1;
    managerSuggestionRequestIdRef.current = requestId;

    const timeoutId = window.setTimeout(() => {
      void fetch(
        apiUrl(
          `/messages/manager-suggestions?managerId=${encodeURIComponent(
            currentManagerId
          )}&q=${encodeURIComponent(normalizedQuery)}`
        )
      )
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(
              await extractApiErrorMessage(
                response,
                "Не удалось получить подсказки сообщений"
              )
            );
          }

          return (await response.json()) as {
            suggestions?: ManagerMessageSuggestion[];
          };
        })
        .then((payload) => {
          if (managerSuggestionRequestIdRef.current !== requestId) {
            return;
          }

          const suggestions = Array.isArray(payload.suggestions)
            ? payload.suggestions
            : [];

          setManagerSuggestions(suggestions);
          setActiveManagerSuggestionIndex(-1);
        })
        .catch((error) => {
          if (managerSuggestionRequestIdRef.current !== requestId) {
            return;
          }

          console.error("Не удалось загрузить подсказки менеджера:", error);
          setManagerSuggestions([]);
          setActiveManagerSuggestionIndex(-1);
        });
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [
    activeChatId,
    currentManagerId,
    messageText,
    showEmojiPicker,
    showQuickReplies,
  ]);

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
    setAttachmentName("");
    setSelectedFiles([]);
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId) {
      setReplyMap({});
      setReplyTarget(null);
      setChatSearchQuery("");
      setActiveChatSearchMatchIndex(0);
      return;
    }

    setReplyMap(readReplyMap(activeChatId));
    setReplyTarget(null);
    setChatSearchQuery("");
    setActiveChatSearchMatchIndex(0);
    setHoveredMessageId("");
    setHighlightedReplyMessageId("");
  }, [activeChatId]);

  useEffect(() => {
    if (chatSearchMatchIds.length === 0) {
      setActiveChatSearchMatchIndex(0);
      return;
    }

    if (activeChatSearchMatchIndex >= chatSearchMatchIds.length) {
      setActiveChatSearchMatchIndex(0);
    }
  }, [activeChatSearchMatchIndex, chatSearchMatchIds.length]);

  useEffect(() => {
    if (sendMode !== "chat" || !currentChatSearchMatchId) {
      return;
    }

    const element = messageElementsRef.current[currentChatSearchMatchId];

    if (!element) {
      return;
    }

    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [currentChatSearchMatchId, sendMode]);

  useEffect(() => {
    return () => {
      if (highlightedReplyTimeoutRef.current) {
        window.clearTimeout(highlightedReplyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setSupplierRequestSupplierFilter("all");
    setSupplierRequestStatusFilter("all");
    setSupplierRequestPeriodFilter("all");
    setEditTarget(null);
    setHoveredEditMessageId("");
  }, [activeChatId]);

  useEffect(() => {
    if (isActiveDirectSupplierDialog && sendMode === "email") {
      setSendMode("chat");
    }
  }, [isActiveDirectSupplierDialog, sendMode]);

  const handleSendMessage = async () => {
    const hasTextToSend = Boolean(messageText.trim());
    const hasAttachmentToSend = selectedFiles.length > 0;
    const isEmailMode = sendMode === "email" && !isActiveDirectSupplierDialog;

    if (editTarget) {
      if (!hasTextToSend || !activeChatId) {
        return;
      }

      try {
        const response = await fetch(apiUrl(`/messages/${editTarget.messageId}`), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: messageText,
            senderType: "manager",
            senderId: currentManagerId,
          }),
        });

        if (!response.ok) {
          throw new Error(
            await extractApiErrorMessage(response, "Не удалось сохранить изменения")
          );
        }

        const updatedMessage = formatMessage((await response.json()) as ApiMessage);

        setChatData((prevChats) =>
          prevChats.map((chat) =>
            chat.id === activeChatId
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === updatedMessage.id ? updatedMessage : message
                  ),
                }
              : chat
          )
        );

        setEditTarget(null);
        setMessageText("");
        setHoveredEditMessageId("");
        return;
      } catch (error) {
        console.error("Ошибка редактирования сообщения:", error);
        setToast({
          message:
            error instanceof Error ? error.message : "Не удалось сохранить изменения",
          tone: "error",
        });
        return;
      }
    }

    if ((!hasTextToSend && !hasAttachmentToSend) || !activeChatId) {
      return;
    }

    if (isEmailMode && hasAttachmentToSend) {
      setToast({
        message: "В MVP email-режим пока поддерживает только текстовые сообщения",
        tone: "info",
      });
      return;
    }

    if (isEmailMode && !emailRecipient.trim()) {
      setToast({
        message: "Укажите email получателя",
        tone: "error",
      });
      return;
    }

    const outgoingMessageText = messageText;
    const outgoingFiles = selectedFiles;
    let createdMessageCount = 0;

    setMessageText("");
    setManagerSuggestions([]);
    setActiveManagerSuggestionIndex(-1);
    lastTypingSentAtRef.current = 0;

    try {
      if (
        activeChat &&
        activeChat.rawStatus === "new" &&
        !activeChat.assignedManagerId &&
        !activeChat.aiEnabled
      ) {
        const claimResponse = await fetch(apiUrl(`/tickets/${activeChatId}/claim`), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            managerId: currentManagerId,
            managerName: currentManagerName,
          }),
        });

        if (!claimResponse.ok) {
          const claimErrorText = await extractApiErrorMessage(
            claimResponse,
            "Этот диалог уже взят другим менеджером"
          );
          const refreshedTickets = await fetchTickets();
          syncTickets(refreshedTickets);
          await refreshNotificationCandidates();
          setToast({
            message: claimErrorText,
            tone: "error",
          });
          return;
        }
      }

      const createdMessages: ChatMessage[] = [];

      if (hasTextToSend) {
        const response = await fetch(apiUrl("/messages"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ticketId: activeChatId,
            content: outgoingMessageText,
            senderType: "manager",
            transport: isEmailMode ? "email" : "chat",
            managerId: currentManagerId,
            managerName: currentManagerName,
            replyToMessageId: replyTarget?.id,
            replyToContent: replyTarget ? getReplyPreviewContent(replyTarget) : undefined,
            toEmail: isEmailMode ? emailRecipient.trim() : undefined,
          }),
        });

        if (!response.ok) {
          throw new Error(
            await extractApiErrorMessage(response, "Не удалось отправить сообщение")
          );
        }

        const newMessage = (await response.json()) as ApiMessage;
        createdMessages.push(formatMessage(newMessage));
        createdMessageCount += 1;
      }

      if (outgoingFiles.length > 0) {
        const formData = new FormData();
        outgoingFiles.forEach((file) => {
          formData.append("files", file);
        });
        formData.append("ticketId", activeChatId);
        formData.append("senderType", "manager");
        formData.append("managerId", currentManagerId);
        formData.append("managerName", currentManagerName);
        if (replyTarget?.id) {
          formData.append("replyToMessageId", replyTarget.id);
          formData.append("replyToContent", getReplyPreviewContent(replyTarget));
        }

        const attachmentResponse = await fetch(apiUrl("/messages/attachment"), {
          method: "POST",
          body: formData,
        });

        if (!attachmentResponse.ok) {
          throw new Error(
            await extractApiErrorMessage(
              attachmentResponse,
              "Не удалось отправить вложение"
            )
          );
        }

        const attachmentMessage = (await attachmentResponse.json()) as ApiMessage;
        createdMessages.push(formatMessage(attachmentMessage));
        createdMessageCount += 1;
      }

      if (createdMessages.length > 0) {
        if (replyTarget) {
          const nextReplyMap = {
            ...replyMap,
            [createdMessages[0].id]: {
              replyToId: replyTarget.id,
              replyToContent: getReplyPreviewContent(replyTarget),
            },
          };

          setReplyMap(nextReplyMap);
          writeReplyMap(activeChatId, nextReplyMap);
          setReplyTarget(null);
        }

        setChatData((prevChats) =>
          prevChats.map((chat) =>
            chat.id === activeChatId
              ? {
                  ...chat,
                  status: getStatusLabel("waiting_client"),
                  headerStatus: getStatusLabel("waiting_client"),
                  rawStatus: "waiting_client",
                  assignedManagerId: chat.assignedManagerId ?? currentManagerId,
                  assignedManagerName: chat.assignedManagerName ?? currentManagerName,
                  messages: [...chat.messages, ...createdMessages],
                }
              : chat
          )
        );
      }

      setFilter("in_progress");
      const refreshedTickets = await fetchTickets();
      syncTickets(refreshedTickets);
      await refreshNotificationCandidates();
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
        scrollManagerChatToBottom("smooth");
      });
    } catch (error) {
      console.error("Ошибка отправки сообщения:", error);
      if (hasTextToSend && createdMessageCount === 0) {
        setMessageText(outgoingMessageText);
      }
      setToast({
        message:
          error instanceof Error ? error.message : "Не удалось отправить сообщение",
        tone: "error",
      });
    }
  };

  const handleClaimIncoming = async (ticketId = activeChatId) => {
    if (!ticketId || !currentManagerId || !currentManagerName) {
      return;
    }

    setIsClaimingIncoming(true);

    try {
      const response = await fetch(apiUrl(`/tickets/${ticketId}/claim`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          managerId: currentManagerId,
          managerName: currentManagerName,
          resolverRole: "manager",
        }),
      });

      if (!response.ok) {
        const errorMessage = await extractApiErrorMessage(
          response,
          "Диалог уже взят другим менеджером"
        );
        const refreshedTickets = await fetchTickets();
        syncTickets(refreshedTickets);
        await refreshNotificationCandidates();
        setToast({
          message: errorMessage,
          tone: "error",
        });
        return;
      }

      const [tickets, messages, supplierRequests] = await Promise.all([
        fetchTickets(),
        fetchMessages(ticketId, true),
        fetchSupplierRequests(ticketId),
      ]);

      setActiveChatId(ticketId);
      setIsChatPaneDismissed(false);
      syncTickets(tickets);
      await refreshNotificationCandidates();
      applyMessagesToTicket(ticketId, messages);
      applySupplierRequestsToTicket(ticketId, supplierRequests);
      setFilter("in_progress");
      setToast({
        message: "Диалог взят в работу",
        tone: "success",
      });
    } catch (error) {
      console.error("Ошибка взятия диалога в работу:", error);
      setToast({
        message: "Не удалось взять диалог в работу",
        tone: "error",
      });
    } finally {
      setIsClaimingIncoming(false);
    }
  };

  const moveChatSearchMatch = (direction: 1 | -1) => {
    if (chatSearchMatchIds.length === 0) {
      return;
    }

    setActiveChatSearchMatchIndex((current) =>
      (current + direction + chatSearchMatchIds.length) %
      chatSearchMatchIds.length
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
    setMessageText(normalizedPhrase);
    setQuickReplySearch("");
    setNewQuickReplyText("");
    setIsQuickReplyModalOpen(false);
    setShowQuickReplies(false);
  };

  const handleOpenCreateClientModal = () => {
    setCreateClientTradePointName("");
    setCreateClientEmail("");
    setCreateClientPhone("");
    setCreateClientError("");
    setIsCreateClientModalOpen(true);
  };

  const handleCreateClientDialog = async () => {
    const normalizedTradePointName = createClientTradePointName.trim();
    const normalizedEmail = createClientEmail.trim();
    const normalizedPhone = createClientPhone.trim();

    if (!normalizedTradePointName || !normalizedEmail || !currentManagerId || !currentManagerName) {
      setCreateClientError("Заполните торговую точку и email");
      return;
    }

    setIsCreatingClientDialog(true);
    setCreateClientError("");

    try {
      const response = await fetch(apiUrl("/tickets/manager-created-client"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          managerId: currentManagerId,
          managerName: currentManagerName,
          tradePointName: normalizedTradePointName,
          clientEmail: normalizedEmail,
          clientPhone: normalizedPhone || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await extractApiErrorMessage(response, "Не удалось создать диалог для клиента")
        );
      }

      const createdTicket = (await response.json()) as ApiTicket;
      const tickets = await fetchTickets();

      syncTickets(tickets);
      setFilter("in_progress");
      setIsChatPaneDismissed(false);
      setActiveChatId(createdTicket.id);
      setIsCreateClientModalOpen(false);
      setToast({
        message: "Клиент добавлен в список диалогов",
        tone: "success",
      });
    } catch (error) {
      console.error("Ошибка создания диалога для клиента:", error);
      setCreateClientError(
        error instanceof Error ? error.message : "Не удалось создать диалог для клиента"
      );
    } finally {
      setIsCreatingClientDialog(false);
    }
  };

  const handleCreateSupplierRequest = async () => {
    if (!supplierRequestText.trim() || !activeChatId) return;
    if (hasOpenSupplierRequest) {
      setCreateSupplierRequestError(
        "У поставщика уже есть активный запрос. Для уточнения используйте внутренний комментарий."
      );
      return;
    }

    setIsCreatingSupplierRequest(true);
    setCreateSupplierRequestError("");

    try {
      if (!selectedSupplierOption) {
        throw new Error("Сначала создайте управленца поставщика с компанией в админке");
      }

      const response = await fetch(apiUrl("/supplier-requests"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticketId: activeChatId,
          supplierId:
            selectedSupplierOption.supplierId?.trim() ||
            `supplier_${selectedSupplierOption.companyName.toLowerCase().replace(/\s+/g, "_")}`,
          supplierName: selectedSupplierOption.companyName,
          requestText: supplierRequestText,
          slaMinutes: 240,
          createdByManagerId: currentManagerId,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось создать запрос поставщику");
      }

      setChatData((prevChats) =>
        prevChats.map((chat) =>
          chat.id === activeChatId
            ? {
                ...chat,
                status: getStatusLabel("waiting_supplier"),
                headerStatus: getStatusLabel("waiting_supplier"),
                rawStatus: "waiting_supplier",
              }
            : chat
        )
      );

      const [messages, supplierRequests] = await Promise.all([
        fetchMessages(activeChatId),
        fetchSupplierRequests(activeChatId),
      ]);

      applyMessagesToTicket(activeChatId, messages);
      applySupplierRequestsToTicket(activeChatId, supplierRequests);

      setSupplierRequestText("");
      setSupplierFollowUpText("");
      setSupplierFollowUpError("");
      setSelectedSupplier(supplierCompanies[0]?.companyName ?? "");
      setIsSupplierFormOpen(false);
      setToast({
        message: isSupplierScopeOnline(selectedSupplierOption?.supplierId ?? null)
          ? `Запрос отправлен поставщику ${selectedSupplierOption?.companyName ?? "Поставщик"}`
          : `Сейчас поставщик ${selectedSupplierOption?.companyName ?? "Поставщик"} не в сети. Как только кто-то появится, запрос сразу уйдёт в работу.`,
        tone: "info",
      });
    } catch (error) {
      console.error("Ошибка создания запроса поставщику:", error);
      setCreateSupplierRequestError("Не удалось создать запрос поставщику");
    } finally {
      setIsCreatingSupplierRequest(false);
    }
  };

  const handleSendSupplierFollowUp = async () => {
    if (!activeChatId || !activeSupplierRequest || !supplierFollowUpText.trim()) {
      return;
    }

    if (
      activeSupplierRequest.supplierSyncPaused &&
      typeof window !== "undefined" &&
      !window.confirm(
        "Поставщик сейчас на паузе. Отправить внутренний комментарий всё равно? Его увидит только поставщик, клиент не увидит."
      )
    ) {
      return;
    }

    setIsSendingSupplierFollowUp(true);
    setSupplierFollowUpError("");

    try {
      const response = await fetch(apiUrl("/messages"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticketId: activeChatId,
          content: supplierFollowUpText.trim(),
          senderType: "manager",
          managerId: currentManagerId,
          managerName: currentManagerName,
          isInternal: true,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await extractApiErrorMessage(
            response,
            "Не удалось отправить внутренний комментарий поставщику"
          )
        );
      }

      const [messages, supplierRequests] = await Promise.all([
        fetchMessages(activeChatId),
        fetchSupplierRequests(activeChatId),
      ]);

      applyMessagesToTicket(activeChatId, messages);
      applySupplierRequestsToTicket(activeChatId, supplierRequests);
      setSupplierFollowUpText("");
      setToast({
        message: "Комментарий отправлен поставщику и скрыт от клиента",
        tone: "info",
      });
    } catch (error) {
      console.error("Ошибка отправки комментария поставщику:", error);
      setSupplierFollowUpError(
        error instanceof Error
          ? error.message
          : "Не удалось отправить внутренний комментарий поставщику"
      );
    } finally {
      setIsSendingSupplierFollowUp(false);
    }
  };

  const handleToggleSupplierSync = async () => {
    if (!activeChatId || !activeSupplierRequest) {
      return;
    }

    setIsTogglingSupplierSync(true);
    setSupplierFollowUpError("");

    try {
      const nextAction = activeSupplierRequest.supplierSyncPaused ? "resume" : "pause";
      const response = await fetch(apiUrl(`/supplier-requests/${activeSupplierRequest.id}/sync`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: nextAction,
          actorType: "manager",
          actorId: currentManagerId,
          actorName: currentManagerName,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await extractApiErrorMessage(
            response,
            nextAction === "pause"
              ? "Не удалось поставить поставщика на паузу"
              : "Не удалось возобновить диалог для поставщика"
          )
        );
      }

      const [messages, supplierRequests] = await Promise.all([
        fetchMessages(activeChatId),
        fetchSupplierRequests(activeChatId),
      ]);

      applyMessagesToTicket(activeChatId, messages);
      applySupplierRequestsToTicket(activeChatId, supplierRequests);
      setToast({
        message:
          nextAction === "pause"
            ? "Поставщик переведён на паузу"
            : "Поставщику снова открыт live-диалог",
        tone: "info",
      });
    } catch (error) {
      console.error("Ошибка переключения паузы поставщика:", error);
      setSupplierFollowUpError(
        error instanceof Error
          ? error.message
          : "Не удалось изменить режим паузы поставщика"
      );
    } finally {
      setIsTogglingSupplierSync(false);
    }
  };

  const handleResolveSupplierRequest = async () => {
    if (!activeChatId || !activeSupplierRequest) {
      return;
    }

    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Принудительно завершить чат поставщика? У поставщика сработает тот же сценарий, как если бы он сам нажал кнопку «Решён»."
      )
    ) {
      return;
    }

    setIsResolvingSupplierRequest(true);
    setSupplierFollowUpError("");

    try {
      const response = await fetch(
        apiUrl(`/supplier-requests/${activeSupplierRequest.id}/status`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: "closed",
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          await extractApiErrorMessage(
            response,
            "Не удалось завершить чат поставщика"
          )
        );
      }

      const [messages, supplierRequests] = await Promise.all([
        fetchMessages(activeChatId),
        fetchSupplierRequests(activeChatId),
      ]);

      applyMessagesToTicket(activeChatId, messages);
      applySupplierRequestsToTicket(activeChatId, supplierRequests);
      setSupplierFollowUpText("");
      setToast({
        message: "Чат поставщика завершён",
        tone: "success",
      });
    } catch (error) {
      console.error("Ошибка принудительного завершения чата поставщика:", error);
      setSupplierFollowUpError(
        error instanceof Error
          ? error.message
          : "Не удалось завершить чат поставщика"
      );
    } finally {
      setIsResolvingSupplierRequest(false);
    }
  };

  const handleSupplierResumeDecision = async (action: "resume" | "resume_defer") => {
    if (!activeChatId || !activeSupplierRequest) {
      return;
    }

    setIsTogglingSupplierSync(true);
    setSupplierFollowUpError("");

    try {
      const response = await fetch(apiUrl(`/supplier-requests/${activeSupplierRequest.id}/sync`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          actorType: "manager",
          actorId: currentManagerId,
          actorName: currentManagerName,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await extractApiErrorMessage(
            response,
            action === "resume"
              ? "Не удалось впустить поставщика в чат"
              : "Не удалось отложить вход поставщика"
          )
        );
      }

      const supplierRequests = await fetchSupplierRequests(activeChatId);
      applySupplierRequestsToTicket(activeChatId, supplierRequests);
      setToast({
        message:
          action === "resume"
            ? "Поставщик снова может писать в чат"
            : "Вход поставщика отложен на 2 минуты",
        tone: "info",
      });
    } catch (error) {
      console.error("Ошибка решения по возврату поставщика:", error);
      setSupplierFollowUpError(
        error instanceof Error
          ? error.message
          : "Не удалось обработать запрос поставщика"
      );
    } finally {
      setIsTogglingSupplierSync(false);
    }
  };

  const handleLogout = () => {
    const session = readAuthSession();

    if (currentManagerId && currentManagerName) {
      void updateManagerPresence(currentManagerId, currentManagerName, "offline").finally(() => {
        void logoutServerSession(session).finally(() => {
          clearAuthSession();
          router.replace("/login");
        });
      });
      return;
    }

    void logoutServerSession(session).finally(() => {
      clearAuthSession();
      router.replace("/login");
    });
  };

  const handleChangeManagerStatus = (status: ManagerPresence) => {
    if (!currentManagerId) {
      return;
    }

    setManagerStatuses((prev) => ({
      ...prev,
      [currentManagerId]: status,
    }));
    setCurrentManagerStatus(status);
    setIsManagerMenuOpen(false);
  };

  const handleTogglePinned = async () => {
    if (!activeChatId) return;

    setIsTogglingPinned(true);

    try {
      const response = await fetch(apiUrl(`/tickets/${activeChatId}/pin`), {
        method: "PATCH",
      });

      if (!response.ok) {
        const errorMessage = await extractApiErrorMessage(
          response,
          "Не удалось изменить закрепление"
        );

        if (response.status === 400 && errorMessage.includes("максимум 3")) {
          setToast({
            message: "Можно закрепить максимум 3 чата",
            tone: "info",
          });
          return;
        }

        if (response.status === 404) {
          setToast({
            message: "Backend был перезапущен. Обновите страницу и попробуйте ещё раз.",
            tone: "error",
          });
          return;
        }

        setToast({
          message: errorMessage,
          tone: "error",
        });
        return;
      }

      const tickets = await fetchTickets();
      syncTickets(tickets);
      await refreshNotificationCandidates();
    } catch (error) {
      console.error("Ошибка изменения закрепления:", error);
      setToast({
        message: "Не удалось изменить закрепление. Проверьте подключение к backend.",
        tone: "error",
      });
    } finally {
      setIsTogglingPinned(false);
    }
  };

  const handleResolveTicket = async (forceCloseSupplierRequests = false) => {
    if (
      !activeChatId ||
      activeChat?.rawStatus === "resolved" ||
      !currentManagerId ||
      !currentManagerName
    )
      return;

    if (hasOpenSupplierRequest && !forceCloseSupplierRequests) {
      setIsResolveSupplierConfirmOpen(true);
      return;
    }

    setIsResolvingTicket(true);
    setIsResolveSupplierConfirmOpen(false);

    try {
      const response = await fetch(apiUrl(`/tickets/${activeChatId}/resolve`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          managerId: currentManagerId,
          managerName: currentManagerName,
          forceCloseSupplierRequests,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await extractApiErrorMessage(response, "Не удалось отметить диалог как решённый")
        );
      }

      const updatedTicket = (await response.json()) as ApiTicket;
      applyTicketUpdate(updatedTicket);
      const [messages, supplierRequests] = await Promise.all([
        fetchMessages(activeChatId),
        fetchSupplierRequests(activeChatId),
      ]);
      applyMessagesToTicket(activeChatId, messages);
      applySupplierRequestsToTicket(activeChatId, supplierRequests);
      setToast({
        message: forceCloseSupplierRequests
          ? "Диалог и чат поставщика отмечены как решённые"
          : "Диалог отмечен как решённый",
        tone: "success",
      });
      setResolvedHighlight({
        ticketId: activeChatId,
        until: Date.now() + 3 * 60 * 1000,
      });
      void (async () => {
        try {
          const tickets = await fetchTickets();
          syncTickets(tickets);
          await refreshNotificationCandidates();
        } catch (backgroundSyncError) {
          console.error(
            "Ошибка фонового обновления после завершения диалога:",
            backgroundSyncError
          );
        }
      })();
    } catch (error) {
      console.error("Ошибка завершения диалога:", error);
      setToast({
        message:
          error instanceof Error ? error.message : "Не удалось отметить диалог как решённый",
        tone: "error",
      });
    } finally {
      setIsResolvingTicket(false);
    }
  };

  const handleStartResolvedDialog = async () => {
    if (!activeChatId || !currentManagerId || !currentManagerName) {
      return;
    }

    try {
      const response = await fetch(apiUrl(`/tickets/${activeChatId}/reopen`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          managerId: currentManagerId,
          managerName: currentManagerName,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось снова открыть диалог");
      }

      const [tickets, messages, supplierRequests] = await Promise.all([
        fetchTickets(),
        fetchMessages(activeChatId),
        fetchSupplierRequests(activeChatId),
      ]);

      syncTickets(tickets);
      await refreshNotificationCandidates();
      applyMessagesToTicket(activeChatId, messages);
      applySupplierRequestsToTicket(activeChatId, supplierRequests);
      setFilter("in_progress");

      window.setTimeout(() => {
        composerTextareaRef.current?.focus();
      }, 100);
    } catch (error) {
      console.error("Ошибка повторного открытия диалога:", error);
    }
  };

  const handleInviteManager = async () => {
    if (!activeChatId || !canManageActiveChatManagers) return;

    const selectedManager = inviteManagerOptions.find(
      (manager) => manager.id === selectedInvitedManagerId
    );

    if (!selectedManager || selectedManager.status !== "online") {
      return;
    }

    setIsInvitingManager(true);
    setInviteManagerError("");

    try {
      const response = await fetch(apiUrl(`/tickets/${activeChatId}/invite-manager`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          managerId: selectedManager.id,
          managerName: selectedManager.name,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось пригласить оператора");
      }

      const [tickets, messages] = await Promise.all([
        fetchTickets(),
        fetchMessages(activeChatId),
      ]);

      syncTickets(tickets);
      await refreshNotificationCandidates();
      applyMessagesToTicket(activeChatId, messages);
      setIsInviteModalOpen(false);
    } catch (error) {
      console.error("Ошибка приглашения оператора:", error);
      setInviteManagerError("Не удалось пригласить оператора");
    } finally {
      setIsInvitingManager(false);
    }
  };

  const handleRemoveInvitedManager = async (managerId: string) => {
    if (!activeChatId || !canManageActiveChatManagers) {
      return;
    }

    setRemovingInvitedManagerId(managerId);
    setInviteManagerError("");

    try {
      const response = await fetch(apiUrl(`/tickets/${activeChatId}/remove-invited-manager`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          managerId,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось отключить менеджера");
      }

      const [tickets, messages] = await Promise.all([
        fetchTickets(),
        fetchMessages(activeChatId),
      ]);

      syncTickets(tickets);
      await refreshNotificationCandidates();
      applyMessagesToTicket(activeChatId, messages);
    } catch (error) {
      console.error("Ошибка отключения менеджера:", error);
      setToast({
        message:
          error instanceof Error ? error.message : "Не удалось отключить менеджера",
        tone: "error",
      });
    } finally {
      setRemovingInvitedManagerId("");
    }
  };

  const handleJoinActiveDialog = async () => {
    if (!activeChatId || !currentManagerId || !resolvedCurrentManagerName) {
      return;
    }

    setIsInvitingManager(true);
    setInviteManagerError("");

    try {
      const response = await fetch(apiUrl(`/tickets/${activeChatId}/invite-manager`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          managerId: currentManagerId,
          managerName: resolvedCurrentManagerName,
        }),
      });

      if (!response.ok) {
        throw new Error(
          await extractApiErrorMessage(response, "Не удалось подключиться к диалогу")
        );
      }

      const [tickets, messages] = await Promise.all([
        fetchTickets(),
        fetchMessages(activeChatId),
      ]);

      syncTickets(tickets);
      await refreshNotificationCandidates();
      applyMessagesToTicket(activeChatId, messages);
      setFilter("in_progress");
      setIsJoinActiveDialogConfirmOpen(false);
      setToast({
        message: "Вы подключились к диалогу",
        tone: "success",
      });

      window.setTimeout(() => {
        composerTextareaRef.current?.focus();
      }, 100);
    } catch (error) {
      console.error("Ошибка подключения к диалогу:", error);
      setToast({
        message:
          error instanceof Error ? error.message : "Не удалось подключиться к диалогу",
        tone: "error",
      });
    } finally {
      setIsInvitingManager(false);
    }
  };

  const handleTransferDialog = async () => {
    if (!activeChatId || !canManageActiveChatManagers) return;

    const selectedManager = transferManagerOptions.find(
      (manager) => manager.id === selectedTransferManagerId
    );

    if (!selectedManager || selectedManager.status !== "online") {
      return;
    }

    setIsTransferringDialog(true);
    setTransferDialogError("");

    try {
      const response = await fetch(apiUrl(`/tickets/${activeChatId}/assign-manager`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          managerId: selectedManager.id,
          managerName: selectedManager.name,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось передать диалог");
      }

      const [tickets, messages] = await Promise.all([
        fetchTickets(),
        fetchMessages(activeChatId),
      ]);

      syncTickets(tickets);
      await refreshNotificationCandidates();
      applyMessagesToTicket(activeChatId, messages);
      setIsTransferModalOpen(false);
      setFilter("in_progress");
    } catch (error) {
      console.error("Ошибка передачи диалога:", error);
      setTransferDialogError("Не удалось передать диалог");
    } finally {
      setIsTransferringDialog(false);
    }
  };

  if (!authReady) {
    return (
      <main className="min-h-screen bg-[#F5F5F7] flex items-center justify-center text-gray-500">
        Проверяем доступ...
      </main>
    );
  }

  const latestSupplierRequest = activeChat?.supplierRequests[0] ?? null;
  const nowForSla = currentTimeMs ?? Date.now();
  const isResolveHighlighted =
    Boolean(activeChat?.id) &&
    resolvedHighlight !== null &&
    resolvedHighlight?.ticketId === activeChat?.id &&
    resolvedHighlight.until > nowForSla;
  const managerSla = buildSlaVisual({
    label: "Первая линия",
    startedAt: activeChat?.firstResponseStartedAt,
    firstResponseAt: activeChat?.firstResponseAt,
    durationMs: activeChat?.firstResponseTime,
    breached: activeChat?.firstResponseBreached,
    slaMs: 2 * 60 * 1000,
    now: nowForSla,
    inactiveText: "Ожидает новый тикет",
  });
  const supplierSla = buildSlaVisual({
    label: "Поставщик",
    startedAt: latestSupplierRequest?.responseStartedAt,
    firstResponseAt: latestSupplierRequest?.firstResponseAt,
    durationMs: latestSupplierRequest?.responseTime,
    breached: latestSupplierRequest?.responseBreached,
    slaMs: 60 * 60 * 1000,
    now: nowForSla,
    inactiveText: "Не активирован",
  });

  return (
    <main
      className="h-screen overflow-hidden bg-[#F5F5F7]"
      style={{ fontFamily: appFontFamily }}
    >
      <div className="flex h-full overflow-hidden">
        <aside className="flex h-full w-[300px] flex-col border-r border-[#E5E5EA] bg-[#FBFBFD] px-4 py-5">
          <div className="mb-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8E8E93]">
                TouchSpace
              </p>
              <h2 className="mt-2 text-[22px] font-semibold text-[#1E1E1E]">
                Обращения
              </h2>
            </div>

            <div ref={managerMenuRef} className="relative mt-4">
              <button
                onClick={() => setIsManagerMenuOpen((prev) => !prev)}
                className="flex w-full items-center gap-2.5 rounded-[16px] border border-[#E9EAF0] bg-white px-3 py-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition hover:border-[#DCE7FF] hover:bg-[#FCFDFF]"
              >
                <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEF6FF]">
                  <Image
                    src="/icons/menedger.svg"
                    alt="Менеджер"
                    width={16}
                    height={16}
                    className="h-4 w-4"
                    style={{
                      filter:
                        "brightness(0) saturate(100%) invert(38%) sepia(98%) saturate(2437%) hue-rotate(204deg) brightness(102%) contrast(101%)",
                    }}
                  />
                  <span
                    className={`absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${managerStatusDots[currentManagerStatus]}`}
                  />
                </div>

                <div className="min-w-0 flex-1 text-left leading-none">
                  <p className="truncate text-[14px] font-semibold text-[#1E1E1E]">
                    {resolvedCurrentManagerName}
                  </p>
                  <p className="mt-1 text-[11px] text-[#8E8E93]">
                    {managerStatusLabels[currentManagerStatus]}
                  </p>
                </div>

                <span className="shrink-0 text-[11px] text-[#AEAEB2]">▾</span>
              </button>

              {isManagerMenuOpen ? (
                <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-[210px] rounded-[18px] border border-[#E5E5EA] bg-white p-2 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                  {(["online", "break", "offline"] as ManagerPresence[]).map((status) => (
                    <button
                      key={status}
                      onClick={() => handleChangeManagerStatus(status)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                        currentManagerStatus === status
                          ? "bg-[#F3F8FF]"
                          : "hover:bg-[#F7F8FB]"
                      }`}
                    >
                      <span className={`h-2.5 w-2.5 rounded-full ${managerStatusDots[status]}`} />
                      <div>
                        <p className="text-[13px] font-medium text-[#1E1E1E]">
                          {managerStatusLabels[status]}
                        </p>
                      </div>
                    </button>
                  ))}

                  <div className="my-2 h-px bg-[#EEF0F4]" />

                  <button
                    onClick={() => router.push("/settings")}
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
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            <button
              onClick={handleOpenCreateClientModal}
              className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-white text-[22px] leading-none text-[#0A84FF] shadow-[0_10px_24px_rgba(10,132,255,0.12)] transition hover:-translate-y-0.5 hover:bg-[#F4F8FF]"
              aria-label="Завести клиента"
              title="Завести клиента"
            >
              +
            </button>

            <button
              onClick={() => setFilter("incoming")}
              className={`rounded-full px-3 py-1.5 text-sm ${
                filter === "incoming"
                  ? "bg-[#0A84FF] text-white"
                  : "bg-white text-[#6C6C70]"
              }`}
            >
              <span>Входящие</span>
              {incomingTabBadgeCount > 0 && (
                <span
                  className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
                    filter === "incoming"
                      ? "bg-white text-[#0A84FF]"
                      : "bg-[#0A84FF] text-white"
                  }`}
                >
                  {incomingTabBadgeCount > 99 ? "99+" : incomingTabBadgeCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setFilter("in_progress")}
              className={`rounded-full px-3 py-1.5 text-sm ${
                filter === "in_progress"
                  ? "bg-[#0A84FF] text-white"
                  : "bg-white text-[#6C6C70]"
              }`}
            >
              <span>Мои</span>
              {myTabBadgeCount > 0 && (
                <span
                  className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
                    filter === "in_progress"
                      ? "bg-white text-[#0A84FF]"
                      : "bg-[#0A84FF] text-white"
                  }`}
                >
                  {myTabBadgeCount > 99 ? "99+" : myTabBadgeCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setFilter("supplier")}
              className={`rounded-full px-3 py-1.5 text-sm ${
                filter === "supplier"
                  ? "bg-[#0A84FF] text-white"
                  : "bg-white text-[#6C6C70]"
              }`}
            >
              Поставщик
              {supplierTabBadgeCount > 0 && (
                <span
                  className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
                    filter === "supplier"
                      ? "bg-white text-[#0A84FF]"
                      : "bg-[#0A84FF] text-white"
                  }`}
                >
                  {supplierTabBadgeCount > 99 ? "99+" : supplierTabBadgeCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setFilter("all")}
              className={`rounded-full px-3 py-1.5 text-sm ${
                filter === "all"
                  ? "bg-[#0A84FF] text-white"
                  : "bg-white text-[#6C6C70]"
              }`}
            >
              Все
              {allTabBadgeCount > 0 && (
                <span
                  className={`ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
                    filter === "all"
                      ? "bg-white text-[#0A84FF]"
                      : "bg-[#0A84FF] text-white"
                  }`}
                >
                  {allTabBadgeCount > 99 ? "99+" : allTabBadgeCount}
                </span>
              )}
            </button>

            <div ref={chatFiltersRef} className="relative">
              <button
                type="button"
                onClick={() => setIsChatFiltersOpen((current) => !current)}
                className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm text-[#6C6C70] shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition hover:bg-[#F4F8FF]"
              >
                <span>Фильтр</span>
                {chatFilterActiveCount > 0 ? (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0A84FF] px-1.5 text-[11px] font-semibold text-white">
                    {chatFilterActiveCount}
                  </span>
                ) : null}
              </button>

              {isChatFiltersOpen ? (
                <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-[320px] rounded-[20px] border border-[#E5E5EA] bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-[#1E1E1E]">Фильтр чатов</p>
                    {chatFilterActiveCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          setChatStatusFilter("all");
                          setChatDateFilterMode("day");
                          setChatDateFilterDay("");
                          setChatDateFilterFrom("");
                          setChatDateFilterTo("");
                        }}
                        className="text-[11px] font-medium text-[#0A84FF]"
                      >
                        Сбросить
                      </button>
                    ) : null}
                  </div>

                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                      Статус
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        ["all", "Все"],
                        ["new", "Новый"],
                        ["in_progress", "В работе"],
                        ["waiting_client", "Ждём клиента"],
                        ["waiting_supplier", "Ждём поставщика"],
                        ["resolved", "Решён"],
                        ["closed", "Закрыт"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setChatStatusFilter(value)}
                          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                            chatStatusFilter === value
                              ? "bg-[#0A84FF] text-white"
                              : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#E5E5EA]"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                      Дата активности
                    </p>
                    <div className="mb-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setChatDateFilterMode("day")}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          chatDateFilterMode === "day"
                            ? "bg-[#111827] text-white"
                            : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#E5E5EA]"
                        }`}
                      >
                        День
                      </button>
                      <button
                        type="button"
                        onClick={() => setChatDateFilterMode("period")}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                          chatDateFilterMode === "period"
                            ? "bg-[#111827] text-white"
                            : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#E5E5EA]"
                        }`}
                      >
                        Период
                      </button>
                    </div>

                    {chatDateFilterMode === "day" ? (
                      <input
                        type="date"
                        value={chatDateFilterDay}
                        onChange={(event) => setChatDateFilterDay(event.target.value)}
                        className="w-full rounded-2xl border border-[#D1D1D6] bg-white px-3 py-3 text-sm text-[#1E1E1E] outline-none"
                      />
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="mb-1 text-xs text-[#8E8E93]">С</p>
                          <input
                            type="date"
                            value={chatDateFilterFrom}
                            onChange={(event) => setChatDateFilterFrom(event.target.value)}
                            className="w-full rounded-2xl border border-[#D1D1D6] bg-white px-3 py-3 text-sm text-[#1E1E1E] outline-none"
                          />
                        </div>
                        <div>
                          <p className="mb-1 text-xs text-[#8E8E93]">По</p>
                          <input
                            type="date"
                            value={chatDateFilterTo}
                            onChange={(event) => setChatDateFilterTo(event.target.value)}
                            className="w-full rounded-2xl border border-[#D1D1D6] bg-white px-3 py-3 text-sm text-[#1E1E1E] outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mb-4">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="w-full rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none placeholder:text-[#8E8E93]"
              placeholder="Поиск по клиенту, диалогу или сообщению..."
            />
          </div>

          {!isAllOverview ? (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {searchedChats.map((chat) => (
                (() => {
                  const unreadCount = getUnreadCount(chat);
                  const chatTone = getChatTone(chat);
                  const isActive = activeChatId === chat.id;
                  const isDirectSupplierDialog =
                    chat.conversationMode === "direct_supplier";
                  const isIncomingQueueChat =
                    chat.rawStatus === "new" && !chat.assignedManagerId && !chat.aiEnabled;

                  return (
                    <DialogListCard
                      key={chat.id}
                      active={isActive}
                      emphasized={
                        unreadCount > 0 ||
                        (!chat.assignedManagerId &&
                          Boolean(chat.claimMissedAt || chat.rescueQueuedAt))
                      }
                      onClick={() => {
                        setIsChatPaneDismissed(false);
                        setActiveChatId(chat.id);
                        setIsSupplierFormOpen(false);
                      }}
                      title={getChatDisplayName(chat)}
                      identityKey={
                        isDirectSupplierDialog
                          ? chat.supplierId || chat.supplierName || chat.id
                          : chat.clientId || chat.clientName || chat.id
                      }
                      avatarColor={chat.avatarColor}
                      avatarEmoji={chat.avatarEmoji}
                      statusDotClassName={isDirectSupplierDialog ? undefined : chatTone.dot}
                      preview={getChatPreview(chat)}
                      managerLabel={
                        isDirectSupplierDialog
                          ? "Прямой чат"
                          : getManagerDisplayName(chat)
                      }
                      timeLabel={formatDialogActivityLabel(
                        chat.lastMessageAt ?? getLastNonSystemMessage(chat)?.createdAt ?? null
                      )}
                      statusLabel={isDirectSupplierDialog ? undefined : chatTone.label}
                      statusBadgeClassName={isDirectSupplierDialog ? undefined : chatTone.pill}
                      unreadCount={unreadCount}
                      pinned={chat.pinned}
                      footerAction={
                        isIncomingQueueChat ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setIsChatPaneDismissed(false);
                              setActiveChatId(chat.id);
                              void handleClaimIncoming(chat.id);
                            }}
                            className="rounded-full bg-[#0A84FF] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0077F2]"
                          >
                            Взять в работу
                          </button>
                        ) : undefined
                      }
                    />
                  );
                })()
              ))}
            </div>
          ) : (
            <div className="min-h-0 flex-1" />
          )}
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#F7F7FA]">
          <IncomingAlertStack
            items={visibleFloatingNotifications.map((candidate) => ({
              id: candidate.notificationKey,
              title:
                candidate.conversationMode === "direct_supplier"
                  ? getDirectSupplierNotificationTitle(candidate)
                  : candidate.tradePointName?.trim() ||
                    candidate.title ||
                    candidate.clientName ||
                    "Клиентский чат",
              subtitle:
                candidate.scopeStatus === "claimed_by_other_recently"
                  ? candidate.assignedManagerName
                    ? `Уже ведёт ${candidate.assignedManagerName}`
                    : "Чат уже забрал другой менеджер"
                  : null,
              preview:
                candidate.scopeStatus === "claimed_by_other_recently"
                  ? candidate.assignedManagerName
                    ? `Чат уже взят в работу менеджером ${candidate.assignedManagerName}`
                    : "Чат уже взят в работу другим менеджером"
                  : candidate.messageText,
              tone:
                candidate.scopeStatus === "claimed_by_other_recently"
                  ? "amber"
                  : candidate.conversationMode === "direct_supplier"
                    ? "green"
                    : "blue",
              avatarEmoji: candidate.avatarEmoji,
              avatarColor: candidate.avatarColor,
              metaLabel:
                candidate.scopeStatus === "missed_unclaimed"
                  ? "Пропущенное сообщение более 10 минут"
                  : candidate.scopeStatus === "rescue_queue"
                    ? "Чат возвращён в общую очередь"
                    : candidate.scopeStatus === "owned_active"
                      ? "Новое сообщение в вашем диалоге"
                      : candidate.waitSeconds > 0
                        ? `Ожидание ${Math.floor(candidate.waitSeconds / 60)} мин ${candidate.waitSeconds % 60} сек`
                        : null,
              primaryLabel:
                candidate.scopeStatus === "claimed_by_other_recently"
                  ? "Открыть"
                  : candidate.scopeStatus === "new_unclaimed" ||
                      candidate.scopeStatus === "missed_unclaimed" ||
                      candidate.scopeStatus === "rescue_queue"
                    ? "Взять в работу"
                    : "Ответить",
              secondaryLabel: "Позже",
            }))}
            onClose={dismissFloatingNotification}
            onSecondary={dismissFloatingNotification}
            onPrimary={(notificationKey) => {
              void handlePrimaryFloatingNotification(notificationKey);
            }}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[#E5E5EA] bg-white px-6 py-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-[18px] font-semibold text-[#1E1E1E]">
                  {activeChat ? getChatDisplayName(activeChat) : "Выберите обращение"}
                </p>
                {activeChat?.aiEnabled ? (
                  <span className="shrink-0 rounded-full bg-[#EEF6FF] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0A84FF]">
                    AI-режим
                  </span>
                ) : null}
              </div>
              {activeChat && !isActiveDirectSupplierDialog ? (
                <div className="mt-1 max-w-[620px]">
                  <PageTrackingCard
                    current={currentPageView}
                    items={ticketPageViews}
                    isLoading={isLoadingPageViews}
                    error={pageViewsError}
                  />
                </div>
              ) : null}
            </div>

            {activeChat ? (
              <div className="flex items-center gap-2">
                {!isActiveDirectSupplierDialog ? (
                <div className="flex items-center gap-2 rounded-[12px] bg-[#F2F2F5] p-1.5">
                  <div className="relative">
                    <button
                      onClick={handleTogglePinned}
                      disabled={isTogglingPinned}
                      onMouseEnter={() => setHoveredHeaderAction("pin")}
                      onMouseLeave={() => setHoveredHeaderAction(null)}
                      className={`flex h-9 w-9 items-center justify-center rounded-[10px] transition duration-200 hover:bg-[#E5F0FF] ${
                        activeChat.pinned ? "bg-[#595FFF]" : "bg-transparent"
                      }`}
                    >
                      <Image
                        src="/icons/zakrepit.svg"
                        alt="Закрепить"
                        width={18}
                        height={18}
                        className={`h-[18px] w-[18px] ${
                          activeChat.pinned ? "brightness-0 invert" : "opacity-70"
                        }`}
                      />
                    </button>
                    {hoveredHeaderAction === "pin" && (
                      <div className="absolute left-1/2 top-[calc(100%+8px)] z-20 -translate-x-1/2 rounded-lg bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_4px_12px_rgba(0,0,0,0.08)] whitespace-nowrap">
                        {activeChat.pinned ? "Открепить чат" : "Закрепить чат"}
                      </div>
                    )}
                  </div>

                  {canManageActiveChatManagers ? (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setSelectedInvitedManagerId(firstOnlineInviteManagerId);
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
                    {hoveredHeaderAction === "invite" && (
                      <div className="absolute left-1/2 top-[calc(100%+8px)] z-20 -translate-x-1/2 rounded-lg bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_4px_12px_rgba(0,0,0,0.08)] whitespace-nowrap">
                        Пригласить менеджера
                      </div>
                    )}
                  </div>
                  ) : null}

                  {canManageActiveChatManagers ? (
                  <div className="relative">
                    <button
                      onClick={() => {
                        setSelectedTransferManagerId(firstOnlineTransferManagerId);
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
                    {hoveredHeaderAction === "transfer" && (
                      <div className="absolute left-1/2 top-[calc(100%+8px)] z-20 -translate-x-1/2 rounded-lg bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_4px_12px_rgba(0,0,0,0.08)] whitespace-nowrap">
                        Передать
                      </div>
                    )}
                  </div>
                  ) : null}
                </div>
                ) : null}

                {!isActiveDirectSupplierDialog ? (
                <div className="relative">
                  {activeChat.rawStatus === "new" &&
                  !activeChat.assignedManagerId &&
                  !activeChat.aiEnabled ? (
                    <button
                      onClick={() => void handleClaimIncoming()}
                      disabled={isClaimingIncoming}
                      className="flex items-center gap-2 rounded-[10px] bg-[#0A84FF] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(10,132,255,0.22)] transition duration-200 hover:scale-[1.02] active:scale-95 disabled:cursor-default disabled:opacity-80"
                    >
                      <span>{isClaimingIncoming ? "Берём..." : "Взять в работу"}</span>
                    </button>
                  ) : null}
                </div>
                ) : null}

                {!isActiveDirectSupplierDialog ? (
                <div className="relative">
                  <button
                    onClick={() => void handleResolveTicket()}
                    disabled={
                      isResolvingTicket ||
                      activeChat.rawStatus === "resolved"
                    }
                    className={`flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold transition duration-200 hover:scale-[1.02] active:scale-95 disabled:cursor-default disabled:opacity-80 ${
                      isResolveHighlighted
                        ? "bg-[#34C759] text-white shadow-[0_10px_24px_rgba(52,199,89,0.22)]"
                        : "bg-[#E9F7EF] text-[#34C759]"
                    }`}
                  >
                    <Image
                      src="/icons/reshen.svg"
                      alt="Решён"
                      width={16}
                      height={16}
                      className="h-4 w-4"
                      style={{
                        filter: isResolveHighlighted
                          ? "brightness(0) saturate(100%) invert(100%)"
                          : "brightness(0) saturate(100%) invert(58%) sepia(78%) saturate(2475%) hue-rotate(317deg) brightness(103%) contrast(98%)",
                      }}
                    />
                    <span>{isResolvingTicket ? "Сохраняем..." : "Решён"}</span>
                  </button>
                  {hasOpenSupplierRequest ? (
                    <div className="absolute right-0 top-[calc(100%+8px)] z-20 whitespace-nowrap rounded-lg bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                      Сначала поставщик должен завершить свой запрос
                    </div>
                  ) : null}
                </div>
                ) : null}

                <div className="relative">
                  <button
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        const nextUrl = new URL(window.location.href);
                        nextUrl.searchParams.delete("ticket");
                        window.history.replaceState({}, "", nextUrl.toString());
                      }

                      setDeepLinkTicketId("");
                      setHoveredHeaderAction(null);
                      setIsChatPaneDismissed(true);
                      setActiveChatId("");
                      setReplyTarget(null);
                      setShowQuickReplies(false);
                      setShowEmojiPicker(false);
                      setIsSupplierFormOpen(false);
                    }}
                    onMouseEnter={() => setHoveredHeaderAction("close")}
                    onMouseLeave={() => setHoveredHeaderAction(null)}
                    className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[#E5E5EA] bg-white text-[#8E8E93] transition duration-200 hover:bg-[#F7F8FB] hover:text-[#1E1E1E]"
                  >
                    ✕
                  </button>
                  {hoveredHeaderAction === "close" && (
                    <div className="absolute right-0 top-[calc(100%+8px)] z-20 whitespace-nowrap rounded-lg bg-white px-3 py-2 text-xs text-[#1E1E1E] shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                      Свернуть
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div />
            )}
          </div>

          {!activeChat ? (
            filter === "all" ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-white px-8 py-8">
                <div className="mx-auto w-full max-w-[1440px]">
                  <div className="mb-5 flex items-center justify-between gap-4 border-b border-[#E5E7EB] pb-4">
                    <div>
                      <h2 className="text-[22px] font-semibold text-[#1E1E1E]">Диалоги</h2>
                      <p className="mt-1.5 text-[13px] text-[#8E8E93]">Найдено {searchedChats.length}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-[minmax(260px,1.7fr)_140px_150px_110px_170px_minmax(200px,1.6fr)] gap-4 px-4 pb-2 text-[12px] font-medium text-[#9AA3AF]">
                    <span>Диалог</span>
                    <span>Ожидание первого ответа</span>
                    <span>Длительность</span>
                    <span>Статус</span>
                    <span>Канал</span>
                    <span>Тема обращения</span>
                  </div>

                  <div className="space-y-1">
                    {searchedChats.map((chat) => {
                      const chatTone = getChatTone(chat);

                      return (
                        <DialogListWideRow
                          key={chat.id}
                          onClick={() => {
                            setIsChatPaneDismissed(false);
                            setActiveChatId(chat.id);
                            setIsSupplierFormOpen(false);
                          }}
                          title={getChatDisplayName(chat)}
                          identityKey={chat.clientId || chat.clientName || chat.id}
                          avatarColor={chat.avatarColor}
                          avatarEmoji={chat.avatarEmoji}
                          statusDotClassName={chatTone.dot}
                          managerLabel={getManagerDisplayName(chat)}
                          lastMessageTimeLabel={formatDialogActivityLabel(
                            chat.lastMessageAt ?? getLastNonSystemMessage(chat)?.createdAt ?? null
                          )}
                          firstResponseLabel={getFirstResponseWaitLabel(chat)}
                          durationLabel={getDialogDurationLabel(chat)}
                          statusLabel={chatTone.label}
                          statusBadgeClassName={chatTone.pill}
                          channelLabel={getChannelLabel(chat)}
                          channelHref={getChannelHref(chat)}
                          topicLabel={getTopicMessage(chat)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-8">
                <div className="mx-auto flex max-w-[420px] flex-col items-center text-center">
                  <div className="relative h-[160px] w-[160px]">
                    <Image
                      src={managerEmptyState.imageSrc}
                      alt={managerEmptyState.title}
                      fill
                      className="object-contain"
                      sizes="160px"
                      priority
                      unoptimized
                    />
                  </div>
                  <h3 className="mt-4 text-[16px] font-semibold text-[#1E1E1E]">
                    {managerEmptyState.title}
                  </h3>
                  <p className="mt-2 max-w-[360px] text-[13px] leading-6 text-[#8E8E93]">
                    {managerEmptyState.description}
                  </p>
                </div>
              </div>
            )
          ) : (
            <>
          {activeChatInvitedManagers.length ? (
            <div className="border-b border-[#EDEDF1] bg-white px-6 py-3">
              <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 text-sm text-[#6C6C70]">
                <span className="rounded-full bg-[#F2F2F7] px-2.5 py-1 text-xs uppercase tracking-[0.12em] text-[#8E8E93]">
                  Подключены
                </span>
                {activeChatInvitedManagers.map((manager) => (
                  <span
                    key={manager.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#F7F7FA] px-2.5 py-1 text-xs text-[#6C6C70]"
                  >
                    {manager.name}
                    {canManageActiveChatManagers ? (
                      <button
                        type="button"
                        onClick={() => void handleRemoveInvitedManager(manager.id)}
                        disabled={removingInvitedManagerId === manager.id}
                        className="flex h-4 w-4 items-center justify-center rounded-full text-[#8E8E93] transition hover:bg-[#E5E5EA] hover:text-[#FD6868] disabled:opacity-50"
                        aria-label={`Отключить ${manager.name}`}
                        title="Отключить менеджера"
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {activeChat?.assignedManagerName ||
          activeChat?.lastResolvedByManagerName ||
          (activeChat && isChatMine(activeChat) && resolvedCurrentManagerName) ||
          activeChat?.aiEnabled ? (
            <div className="border-b border-[#EDEDF1] bg-white px-6 py-3">
              <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 text-sm text-[#6C6C70]">
                {activeChat?.aiEnabled ? (
                  <>
                    <span className="rounded-full bg-[#EEF6FF] px-2.5 py-1 text-xs uppercase tracking-[0.12em] text-[#0A84FF]">
                      Сейчас ведёт
                    </span>
                    <span className="mr-3 font-medium text-[#0A84FF]">AI-помощник</span>
                  </>
                ) : null}

                {activeChat.assignedManagerName || (isChatMine(activeChat) && resolvedCurrentManagerName) ? (
                  <>
                    <span className="rounded-full bg-[#F2F2F7] px-2.5 py-1 text-xs uppercase tracking-[0.12em] text-[#8E8E93]">
                      Сейчас ведёт
                    </span>
                    <span className="mr-3">
                      {resolveManagerName(activeChat.assignedManagerId, activeChat.assignedManagerName)}
                      {(activeChat.assignedManagerId === currentManagerId ||
                        (!activeChat.assignedManagerId &&
                          resolveManagerName(null, activeChat.assignedManagerName) === resolvedCurrentManagerName))
                        ? " (Вы)"
                        : ""}
                    </span>
                    {activeChat.handedToManagerAt ? (
                      <span className="rounded-full bg-[#EEF6FF] px-2.5 py-1 text-xs text-[#0A84FF]">
                        Взял {formatRelativeClaimTime(activeChat.handedToManagerAt)}
                      </span>
                    ) : null}
                  </>
                ) : null}

                {activeChat.lastResolvedByManagerName ? (
                  <>
                    <span className="rounded-full bg-[#F2F2F7] px-2.5 py-1 text-xs uppercase tracking-[0.12em] text-[#8E8E93]">
                      Ранее вёл
                    </span>
                    <span>
                      {resolveManagerName(
                        activeChat.lastResolvedByManagerId,
                        activeChat.lastResolvedByManagerName
                      )}
                      {activeChat.lastResolvedByManagerId === currentManagerId ? " (Вы)" : ""}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          <div
            ref={messagesViewportRef}
            onScroll={updateManagerScrollState}
            className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
          >
            <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4">
            {activeChat?.messages.map((message, index) => {
              const previousMessage = activeChat.messages[index - 1];
              const shouldShowDateSeparator =
                !previousMessage ||
                getMessageDayKey(previousMessage.createdAt) !==
                  getMessageDayKey(message.createdAt);
              const isSearchMatched = chatSearchMatchIdSet.has(message.id);
              const isCurrentSearchMatch = currentChatSearchMatchId === message.id;
              const authorLabel = getManagerMessageAuthorLabel(message);

              return (
                <div
                  key={message.id}
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

                  {message.from === "system" ? (
                    <div className="flex justify-center py-2">
                      <div className="w-full max-w-[560px] rounded-[22px] border border-[#E5E5EA] bg-[#F7F7FA] px-5 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8E8E93]">
                            Системное событие
                          </p>
                          {message.time ? (
                            <p className="shrink-0 text-[11px] text-[#AEAEB2]">
                              {message.time}
                            </p>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm leading-5 text-[#6C6C70]">
                          {renderHighlightedText(message.text, chatSearchQuery)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`flex ${
                        message.from === "manager"
                          ? "justify-end"
                          : "justify-start"
                      }`}
                    >
                              <div
                                className={`group relative inline-block w-fit max-w-[calc(88%+40px)] ${
                                  message.from === "manager"
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
                                  } ${message.from === "manager" ? "left-0" : "right-0"}`}
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
                                  {canEditManagerMessage(message) ? (
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

                        <div className="inline-flex max-w-full flex-col">
                          <div
                            className={`relative inline-block min-h-[44px] min-w-[84px] max-w-full rounded-[22px] px-4 pb-[10px] pt-3 align-top text-[15px] leading-[21px] shadow-sm transition ${
                              message.from === "manager" && message.isInternal
                                ? "border border-[#E4D5B7] bg-[#FFF8EE] text-[#6B4F1D] shadow-[0_10px_24px_rgba(193,129,43,0.12)]"
                                : message.from === "manager"
                                ? "bg-[#0A84FF] text-white shadow-[0_10px_24px_rgba(10,132,255,0.24)]"
                                : message.from === "ai"
                                  ? "border border-[#D9E8FF] bg-[#EFF6FF] text-[#0B3B78]"
                                  : message.from === "client"
                                    ? "border border-[#E6EAF2] bg-white text-[#1E1E1E] shadow-[0_16px_36px_rgba(15,23,42,0.08)]"
                                    : message.from === "supplier"
                                      ? "bg-[#EAF8EF] text-[#166534]"
                                      : "bg-[#EFEFF4] text-[#1E1E1E]"
                            }`}
                          >
                            <div className="min-w-0 max-w-full">
                            {authorLabel ? (
                              <p className="mb-0.5 text-[11px] font-medium opacity-60">
                                {authorLabel}
                              </p>
                            ) : null}
                            {message.from === "ai" || message.from === "supplier" || message.isInternal ? (
                              <p className="mb-0.5 text-[11px] opacity-60">
                                {message.from === "ai" && "AI-помощник"}
                                {message.from === "supplier" &&
                                  `Поставщик: ${getDirectSupplierMessageDisplayNameForChat(activeChat, message.senderName)}`}
                                {message.isInternal && "Внутренний комментарий поставщику"}
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
                                  message.from === "manager"
                                    ? "hover:bg-white/10"
                                    : "hover:bg-[#F2F7FF]"
                                }`}
                              >
                                <div className="flex min-w-0 items-start gap-2">
                                  <span
                                    className={`mt-0.5 h-[20px] w-[3px] shrink-0 rounded-full ${
                                      message.from === "manager" ? "bg-white/55" : "bg-[#0A84FF]"
                                    }`}
                                  />
                                  <div className="min-w-0">
                                  <p
                                    className={`text-[11px] font-semibold ${
                                      message.from === "manager"
                                        ? "text-white/78"
                                        : "text-[#0A84FF]"
                                    }`}
                                  >
                                    Ответ
                                  </p>
                                  <p
                                    className={`mt-1 line-clamp-2 text-[13px] leading-[18px] [overflow-wrap:break-word] [word-break:normal] ${
                                      message.from === "manager"
                                        ? "text-white/82"
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
                                tone={message.from === "manager" ? "outgoing" : "incoming"}
                              />
                            ) : (
                                      <p className="min-w-0 max-w-full whitespace-pre-wrap pr-[76px] [overflow-wrap:break-word] [word-break:normal]">
                                        {renderHighlightedText(message.text, chatSearchQuery)}
                                      </p>
                            )}
                              <div
                                className={`absolute bottom-[10px] right-4 inline-flex items-center gap-1 whitespace-nowrap text-[12px] leading-none ${
                                  message.from === "manager"
                                    ? message.isInternal
                                      ? "text-[#8B6A33]"
                                      : "text-white/65"
                                    : message.from === "ai"
                                      ? "text-[#4C6A92]"
                                      : "text-[#8E8E93]"
                                }`}
                              >
                                {message.time ? <p className="shrink-0">{message.time}</p> : null}
                                {message.from === "manager" ? (
                                  <MessageStatusChecks status={message.status} />
                                ) : null}
                              </div>
                            </div>
                          </div>
                          {message.messageType === "email" ? (
                            <p
                              className={`mt-2 px-1 text-[13px] leading-5 text-[#98A2B3] ${
                                message.from === "manager" ? "text-right" : "text-left"
                              }`}
                            >
                              {message.from === "manager"
                                ? "отправлено email"
                                : "получено email"}
                            </p>
                          ) : null}
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
            <div className="pointer-events-none absolute right-[112px] top-[126px] z-30">
              <div
                className={`min-w-[300px] rounded-[24px] border px-5 py-4 shadow-[0_24px_60px_rgba(15,23,42,0.16)] backdrop-blur-sm ${
                  toast.tone === "error"
                    ? "border-[#FFD5D5] bg-[#FFF6F6] text-[#C53C3C]"
                    : toast.tone === "info"
                      ? "border-[#0A84FF] bg-[#0A84FF] text-white"
                      : "border-[#BDE9CB] bg-[linear-gradient(135deg,#F1FFF5_0%,#E3F9EA_100%)] text-[#167C3E]"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${
                      toast.tone === "error"
                        ? "bg-[#FFE3E3] text-[#C53C3C]"
                        : toast.tone === "info"
                          ? "bg-white/20 text-white"
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

          {shouldShowSupplierResumePrompt ? (
            <div className="absolute left-1/2 top-[118px] z-30 w-full max-w-[460px] -translate-x-1/2 px-4">
              <div className="rounded-[28px] border border-[#D6E7FF] bg-white p-5 shadow-[0_24px_60px_rgba(15,23,42,0.16)]">
                <p className="text-base font-semibold text-[#1E1E1E]">
                  Поставщик хочет вернуться в чат
                </p>
                <p className="mt-2 text-sm leading-6 text-[#5A6270]">
                  Если впустить сейчас, поставщик сразу увидит новую live-переписку и сможет писать
                  в чат.
                </p>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => handleSupplierResumeDecision("resume")}
                    disabled={isTogglingSupplierSync}
                    className="flex-1 rounded-2xl bg-[#0A84FF] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    Впустить
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSupplierResumeDecision("resume_defer")}
                    disabled={isTogglingSupplierSync}
                    className="flex-1 rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm font-semibold text-[#1E1E1E] disabled:opacity-60"
                  >
                    Позже
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {showScrollToLatest ? (
            <div className="pointer-events-none absolute bottom-[168px] left-1/2 z-30 -translate-x-1/2">
              <button
                type="button"
                onClick={() => scrollManagerChatToBottom("smooth")}
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

          {isClientTyping && activeChat?.rawStatus !== "resolved" ? (
            <div className="border-t border-transparent bg-white px-6 pb-2 pt-1">
              <div className="mx-auto w-full max-w-3xl">
                <div className="inline-flex max-w-[70%] items-end gap-2 rounded-[20px] rounded-bl-[8px] border border-[#E6EBF3] bg-[#FBFCFE] px-4 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-[#9AA5B5]">
                      {getChatDisplayName(activeChat)} печатает
                    </p>
                    <div className="mt-1 flex items-end gap-2">
                      <p className="line-clamp-3 break-words text-[15px] leading-6 text-[#667085]">
                        {clientTypingPreview || "…"}
                      </p>
                      <div className="mb-1 flex items-end gap-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#A9B7CA] [animation-delay:-0.24s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#A9B7CA] [animation-delay:-0.12s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#A9B7CA]" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
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
              {activeChat?.rawStatus === "resolved" ? (
                <button
                  onClick={handleStartResolvedDialog}
                  className="flex min-h-[72px] w-full items-center justify-center rounded-[28px] border border-[#DCE7FF] bg-white px-6 py-5 text-base font-semibold text-[#0A84FF] shadow-[0_14px_32px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:bg-[#F7FAFF]"
                >
                  Начать диалог
                </button>
              ) : activeChat && !canCurrentManagerWriteToChat(activeChat) ? (
                <div className="space-y-3">
                  <button
                    onClick={() => setIsJoinActiveDialogConfirmOpen(true)}
                    disabled={isInvitingManager}
                    className="flex min-h-[72px] w-full items-center justify-center rounded-[28px] border border-[#D1D1D6] bg-[#F2F2F7] px-6 py-5 text-base font-semibold text-[#6C6C70] shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:bg-[#E9E9EF] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                  >
                    {isInvitingManager ? "Подключаем..." : "Начать диалог"}
                  </button>
                  <p className="text-sm text-[#8E8E93]">
                    Сейчас этот чат ведёт другой менеджер. Вы можете читать переписку уже сейчас,
                    а писать сможете после нажатия кнопки.
                  </p>
                </div>
              ) : (
                <>
              {attachmentName ? (
                <div className="mb-3 flex">
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#D8D8DE] bg-[#F7F7FA] px-3 py-1.5 text-sm text-[#1E1E1E]">
                    <span className="truncate max-w-[240px]">{attachmentName}</span>
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
                    <p className="text-xs font-semibold text-[#C1812B]">Редактирование сообщения</p>
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
                {!isActiveDirectSupplierDialog ? (
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
                ) : null}
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
                          {chatSearchMatchIds.length
                            ? `${normalizedActiveChatSearchMatchIndex + 1}/${chatSearchMatchIds.length}`
                            : "0"}
                        </span>
                        <button
                          type="button"
                          onClick={() => moveChatSearchMatch(-1)}
                          disabled={chatSearchMatchIds.length === 0}
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
                          disabled={chatSearchMatchIds.length === 0}
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
                {!isActiveDirectSupplierDialog && sendMode === "email" ? (
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
                  <div className="relative">
                    {isManagerSuggestionsOpen ? (
                      <div
                        ref={managerSuggestionsRef}
                        className="absolute bottom-[calc(100%+12px)] left-0 right-0 z-30 overflow-hidden rounded-[18px] border border-[#E4E6EB] bg-white shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
                      >
                        {managerSuggestions.map((suggestion, index) => (
                          <button
                            key={`${suggestion.text}-${suggestion.lastUsedAt}`}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              applyManagerSuggestion(suggestion.text);
                            }}
                            onMouseEnter={() =>
                              setActiveManagerSuggestionIndex(index)
                            }
                            className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                              index === activeManagerSuggestionIndex
                                ? "bg-[#F5F9FF]"
                                : "bg-white hover:bg-[#F9FBFF]"
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full text-xs font-semibold ${
                                index === activeManagerSuggestionIndex
                                  ? "bg-[#DCEBFF] text-[#0A84FF]"
                                  : "bg-[#EEF2F8] text-[#6B7280]"
                              }`}
                            >
                              {index + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-[14px] leading-5 text-[#1E1E1E]">
                                {suggestion.text}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <textarea
                      ref={composerTextareaRef}
                      value={messageText}
                      onBlur={() => {
                        window.setTimeout(() => {
                          const activeElement = document.activeElement;

                          if (
                            managerSuggestionsRef.current &&
                            activeElement &&
                            managerSuggestionsRef.current.contains(activeElement)
                          ) {
                            return;
                          }

                          setManagerSuggestions([]);
                          setActiveManagerSuggestionIndex(-1);
                        }, 100);
                      }}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setMessageText(nextValue);

                        if (activeChatId && nextValue.trim()) {
                          emitManagerTyping(activeChatId);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (isManagerSuggestionsOpen && managerSuggestions.length > 0) {
                          if (e.key === "ArrowDown") {
                            e.preventDefault();
                            setActiveManagerSuggestionIndex((prev) =>
                              prev < 0 || prev >= managerSuggestions.length - 1 ? 0 : prev + 1
                            );
                            return;
                          }

                          if (e.key === "ArrowUp") {
                            e.preventDefault();
                            setActiveManagerSuggestionIndex((prev) =>
                              prev <= 0 ? managerSuggestions.length - 1 : prev - 1
                            );
                            return;
                          }

                          if (e.key === "Escape") {
                            e.preventDefault();
                            setManagerSuggestions([]);
                            setActiveManagerSuggestionIndex(-1);
                            return;
                          }

                          if (
                            (e.key === "Enter" && !e.shiftKey) ||
                            e.key === "Tab"
                          ) {
                            e.preventDefault();
                            const selectedSuggestion =
                              activeManagerSuggestionIndex >= 0
                                ? managerSuggestions[activeManagerSuggestionIndex]
                                : null;

                            if (selectedSuggestion) {
                              applyManagerSuggestion(selectedSuggestion.text);
                              return;
                            }
                          }
                        }

                        if (
                          activeChatId &&
                          e.key.length === 1 &&
                          !e.ctrlKey &&
                          !e.metaKey &&
                          !e.altKey
                        ) {
                          emitManagerTyping(activeChatId);
                        }

                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSendMessage();
                        }
                      }}
                      rows={1}
                      className="min-h-[40px] max-h-[132px] w-full resize-none overflow-y-auto bg-transparent py-2 text-[15px] leading-6 text-[#1E1E1E] outline-none placeholder:text-[#8E8E93]"
                      placeholder={
                        sendMode === "email"
                          ? "Напишите email клиенту..."
                          : "Напишите сообщение..."
                      }
                    />
                  </div>
                </div>

                <div ref={quickRepliesRef} className="relative flex items-center gap-2">
                  {showQuickReplies && (
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
                              setMessageText(phrase);
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
                  )}

                  {showEmojiPicker && (
                    <div className="absolute bottom-[calc(100%+14px)] right-10 z-20 w-[300px] rounded-[20px] border border-[#E4E6EB] bg-white p-3 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                      <div className="mb-3 px-1 text-[13px] font-semibold text-[#1E1E1E]">
                        Смайлики
                      </div>
                      <div className="grid grid-cols-5 gap-2">
                        {EMOJI_REACTIONS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => {
                              setMessageText((prev) => `${prev}${emoji}`);
                              setShowEmojiPicker(false);
                            }}
                            className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#FBFBFD] text-xl transition hover:bg-[#EEF6FF]"
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      setShowQuickReplies((prev) => !prev);
                      setShowEmojiPicker(false);
                      setManagerSuggestions([]);
                      setActiveManagerSuggestionIndex(-1);
                    }}
                    onMouseEnter={() => setHoveredComposerAction("quick")}
                    onMouseLeave={() => setHoveredComposerAction(null)}
                    className={`relative flex h-[38px] w-[38px] items-center justify-center rounded-xl transition ${
                      showQuickReplies ? "bg-[#E5F0FF]" : "bg-transparent hover:bg-[#E5F0FF]"
                    }`}
                  >
                    <Image
                      src="/icons/fraza.svg"
                      alt="Быстрые фразы"
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px]"
                      style={{
                        filter: showQuickReplies || hoveredComposerAction === "quick"
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
                      setManagerSuggestions([]);
                      setActiveManagerSuggestionIndex(-1);
                    }}
                    onMouseEnter={() => setHoveredComposerAction("emoji")}
                    onMouseLeave={() => setHoveredComposerAction(null)}
                    className={`relative flex h-[38px] w-[38px] items-center justify-center rounded-xl transition ${
                      showEmojiPicker ? "bg-[#E5F0FF]" : "bg-transparent hover:bg-[#E5F0FF]"
                    }`}
                  >
                    <Image
                      src="/icons/smail.svg"
                      alt="Смайлики"
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px]"
                      style={{
                        filter: showEmojiPicker || hoveredComposerAction === "emoji"
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
                        setToast({
                          message: validationMessage,
                          tone: "error",
                        });
                        setSelectedFiles([]);
                        setAttachmentName("");
                        event.target.value = "";
                        return;
                      }

                      setSelectedFiles(files);
                      setAttachmentName(getChatAttachmentSelectionSummary(files));
                      event.target.value = "";
                    }}
                  />
                </div>

                <button
                  onClick={handleSendMessage}
                  disabled={!messageText.trim() && selectedFiles.length === 0}
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
              )}
            </div>
          </div>
            </>
          )}
        </section>

        {activeChat ? (
        <aside className="flex h-full w-[320px] flex-col overflow-y-auto border-l border-[#E5E5EA] bg-[#FBFBFD] px-4 py-5">
          {isActiveDirectSupplierDialog ? (
            <div className="rounded-[24px] border border-[#E5E5EA] bg-white p-5 shadow-sm">
              <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                Поставщик
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                    Компания
                  </p>
                  <p className="mt-1 text-base font-semibold text-[#1E1E1E]">
                    {getDirectSupplierCompanyName(activeChat)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                    Сотрудник
                  </p>
                  <p className="mt-1 text-base font-semibold text-[#1E1E1E]">
                    {getDirectSupplierContactName(activeChat) ||
                      getSupplierPresenceContactName(activeChat) ||
                      "Имя пока не указано"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
          <>
          <div className="mb-4 rounded-[24px] border border-[#E5E5EA] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                Статус
              </p>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  getStatusBadgeClass(activeChat?.rawStatus)
                }`}
              >
                {activeChat?.rawStatus === "resolved" ? "Решён" : activeChat?.status || "Открыт"}
              </span>
            </div>
          </div>

          <ContactCard
            contacts={ticketContacts}
            canManage
            isLoading={isLoadingContacts}
            isSaving={isSavingContacts}
            error={contactsError}
            onAdd={handleAddContact}
            onUpdate={handleUpdateContact}
            onDelete={handleDeleteContact}
          />

          <div className="mb-4 rounded-[24px] border border-[#E5E5EA] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#1E1E1E]">Поставщик</p>
              {activeChat?.supplierRequests.length ? (
                <span className="rounded-full bg-[#F2F2F7] px-2.5 py-1 text-xs text-[#6C6C70]">
                  {activeChat.supplierRequests.length}
                </span>
              ) : null}
            </div>

            <button
              onClick={() => setIsSupplierFormOpen(!isSupplierFormOpen)}
              className={`w-full rounded-2xl py-3 text-sm font-medium text-white ${
                hasOpenSupplierRequest ? "bg-[#A0A7B4]" : "bg-[#0A84FF]"
              }`}
            >
              {isSupplierFormOpen
                ? "Скрыть форму"
                : hasOpenSupplierRequest
                  ? "Активный запрос уже открыт"
                  : "Запросить поставщика"}
            </button>

            {isSupplierFormOpen && (
              <div className="mt-4 space-y-3 border-t border-[#F0F0F2] pt-4">
                {activeSupplierRequest ? (
                  <>
                    <div className="rounded-[18px] border border-[#E8ECF3] bg-[#F8FAFD] p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                        Активный запрос
                      </p>
                      <p className="mt-2 text-sm font-semibold text-[#1E1E1E]">
                        {activeSupplierRequest.supplierName}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-[#5A6270]">
                        {activeSupplierRequest.requestText}
                      </p>
                      {isActiveSupplierRequestPaused ? (
                        <p className="mt-3 inline-flex rounded-full bg-[#FFF4DE] px-3 py-1 text-xs font-semibold text-[#B7791F]">
                          Поставщик на паузе
                        </p>
                      ) : null}
                    </div>

                    <button
                      onClick={handleToggleSupplierSync}
                      disabled={isTogglingSupplierSync}
                      className={`w-full rounded-xl py-3 font-medium text-white ${
                        isActiveSupplierRequestPaused ? "bg-[#0A84FF]" : "bg-[#6C6C70]"
                      }`}
                    >
                      {isTogglingSupplierSync
                        ? "Сохраняем..."
                        : isActiveSupplierRequestPaused
                          ? "Возобновить"
                          : "Пауза"}
                    </button>

                    <button
                      onClick={handleResolveSupplierRequest}
                      disabled={isResolvingSupplierRequest}
                      className="w-full rounded-xl bg-[#C1812B] py-3 font-medium text-white"
                    >
                      {isResolvingSupplierRequest
                        ? "Завершаем..."
                        : "Завершить чат поставщика"}
                    </button>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-[#1E1E1E]">
                        Напомнить или уточнить поставщику
                      </label>
                      <textarea
                        value={supplierFollowUpText}
                        onChange={(e) => setSupplierFollowUpText(e.target.value)}
                        className="min-h-[96px] w-full resize-none rounded-2xl border border-[#D1D1D6] bg-white px-3 py-3 text-sm text-[#1E1E1E] outline-none placeholder:text-[#98A2B3]"
                        placeholder="Например: клиент ждёт ответ сегодня до 16:00. Это сообщение увидит только поставщик."
                      />
                      <p className="mt-2 text-xs text-[#8E8E93]">
                        Это внутренний комментарий. Клиент его не увидит.
                      </p>
                    </div>

                    <button
                      onClick={handleSendSupplierFollowUp}
                      disabled={isSendingSupplierFollowUp}
                      className="w-full rounded-xl bg-[#C1812B] py-3 font-medium text-white"
                    >
                      {isSendingSupplierFollowUp
                        ? "Отправляем..."
                        : "Отправить комментарий поставщику"}
                    </button>

                    {supplierFollowUpError ? (
                      <p className="text-sm text-red-500">{supplierFollowUpError}</p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[#1E1E1E]">
                        Поставщик
                      </label>
                      <select
                        value={selectedSupplier}
                        onChange={(e) => setSelectedSupplier(e.target.value)}
                        className="w-full rounded-2xl border border-[#D1D1D6] bg-white px-3 py-3 text-sm outline-none"
                      >
                        {supplierCompanies.length === 0 ? (
                          <option value="">Нет доступных компаний поставщиков</option>
                        ) : null}
                        {supplierCompanies.map((supplier) => (
                          <option key={supplier.supervisorProfileId} value={supplier.companyName}>
                            {supplier.companyName}
                          </option>
                        ))}
                      </select>
                      {supplierCompaniesError ? (
                        <p className="mt-2 text-xs text-red-500">{supplierCompaniesError}</p>
                      ) : supplierCompanies.length === 0 ? (
                        <p className="mt-2 text-xs text-[#8E8E93]">
                          Сначала создайте управленца поставщика с нужной компанией в админке.
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <label className="mb-1 block text-sm font-medium text-[#1E1E1E]">
                        Комментарий
                      </label>
                      <textarea
                        value={supplierRequestText}
                        onChange={(e) => setSupplierRequestText(e.target.value)}
                        className="min-h-[100px] w-full resize-none rounded-2xl border border-[#D1D1D6] bg-white px-3 py-3 text-sm text-[#1E1E1E] outline-none placeholder:text-[#98A2B3]"
                        placeholder="Например: подтвердите наличие и срок поставки по заказу..."
                      />
                    </div>

                    <button
                      onClick={handleCreateSupplierRequest}
                      disabled={isCreatingSupplierRequest}
                      className="w-full rounded-xl bg-[#111827] py-3 font-medium text-white"
                    >
                      {isCreatingSupplierRequest
                        ? "Отправляем..."
                        : "Отправить запрос поставщику"}
                    </button>

                    {createSupplierRequestError && (
                      <p className="text-sm text-red-500">{createSupplierRequestError}</p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-[#E5E5EA] bg-white shadow-sm">
            <div className="sticky top-0 z-10 rounded-t-[24px] border-b border-[#F0F0F2] bg-white/95 px-4 py-4 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-[#1E1E1E]">Запросы поставщикам</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#8E8E93]">
                    {filteredSupplierRequests.length}
                  </span>
                  <div ref={supplierRequestsFilterRef} className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setIsSupplierRequestsFilterOpen((current) => !current)
                      }
                      className="inline-flex items-center gap-2 rounded-full border border-[#E5E5EA] bg-[#F7F8FB] px-3 py-2 text-xs font-medium text-[#4B5563] transition hover:bg-[#EEF4FF]"
                    >
                      <span>Фильтр</span>
                      {supplierRequestActiveFilterCount > 0 ? (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0A84FF] px-1.5 text-[11px] font-semibold text-white">
                          {supplierRequestActiveFilterCount}
                        </span>
                      ) : null}
                    </button>

                    {isSupplierRequestsFilterOpen ? (
                      <div className="absolute right-0 top-[calc(100%+10px)] z-30 w-[280px] rounded-[20px] border border-[#E5E5EA] bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-[#1E1E1E]">Фильтры</p>
                          {supplierRequestActiveFilterCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSupplierRequestSupplierFilter("all");
                                setSupplierRequestStatusFilter("all");
                                setSupplierRequestPeriodFilter("all");
                              }}
                              className="text-[11px] font-medium text-[#0A84FF]"
                            >
                              Сбросить
                            </button>
                          ) : null}
                        </div>

                        {(availableSupplierRequestSuppliers.length > 0 ||
                          availableSupplierRequestStatuses.length > 0) && (
                          <div className="space-y-3">
                            {availableSupplierRequestSuppliers.length > 0 ? (
                              <div>
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                                  Поставщик
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setSupplierRequestSupplierFilter("all")}
                                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                                      supplierRequestSupplierFilter === "all"
                                        ? "bg-[#0A84FF] text-white"
                                        : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#E5E5EA]"
                                    }`}
                                  >
                                    Все
                                  </button>
                                  {availableSupplierRequestSuppliers.map((supplierName) => (
                                    <button
                                      key={supplierName}
                                      type="button"
                                      onClick={() => setSupplierRequestSupplierFilter(supplierName)}
                                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                                        supplierRequestSupplierFilter === supplierName
                                          ? "bg-[#0A84FF] text-white"
                                          : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#E5E5EA]"
                                      }`}
                                    >
                                      {supplierName}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {availableSupplierRequestStatuses.length > 0 ? (
                              <div>
                                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                                  Статус
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setSupplierRequestStatusFilter("all")}
                                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                                      supplierRequestStatusFilter === "all"
                                        ? "bg-[#111827] text-white"
                                        : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#E5E5EA]"
                                    }`}
                                  >
                                    Все
                                  </button>
                                  {availableSupplierRequestStatuses.map((status) => (
                                    <button
                                      key={status}
                                      type="button"
                                      onClick={() => setSupplierRequestStatusFilter(status)}
                                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                                        supplierRequestStatusFilter === status
                                          ? "bg-[#111827] text-white"
                                          : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#E5E5EA]"
                                      }`}
                                    >
                                      {getStatusLabel(status)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                                Период
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {[
                                  ["today", "Сегодня"],
                                  ["yesterday", "Вчера"],
                                  ["week", "За неделю"],
                                  ["month", "За месяц"],
                                  ["all", "Все"],
                                ].map(([value, label]) => (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() =>
                                      setSupplierRequestPeriodFilter(
                                        value as SupplierRequestPeriodFilter
                                      )
                                    }
                                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                                      supplierRequestPeriodFilter === value
                                        ? "bg-[#34C759] text-white"
                                        : "bg-[#F2F2F7] text-[#6C6C70] hover:bg-[#E5E5EA]"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`px-4 py-4 ${
                filteredSupplierRequests.length > 3
                  ? "max-h-[440px] overflow-y-auto pr-3"
                  : ""
              }`}
            >
              <div className="space-y-4">
                {isLoadingSupplierRequests && (
                  <p className="text-sm text-gray-500">Загружаем запросы...</p>
                )}

                {supplierRequestsError && (
                  <p className="text-sm text-red-500">{supplierRequestsError}</p>
                )}

                {filteredSupplierRequests.length ? (
                  filteredSupplierRequests.map((request) => (
                    <div
                      key={request.id}
                      className="space-y-3 rounded-[20px] border border-[#ECECF1] bg-[#FCFCFD] p-3"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-[#1E1E1E]">{request.supplierName}</p>
                          <span className="rounded-full bg-[#F2F2F7] px-2.5 py-1 text-[11px] text-[#6C6C70]">
                            {getStatusLabel(request.status)}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          Создан: {request.createdAt}
                        </p>
                        <p className="mt-2 text-xs text-gray-500">
                          {request.requestText}
                        </p>
                      </div>
                    </div>
                  ))
                ) : !isLoadingSupplierRequests && !supplierRequestsError ? (
                  <p className="text-sm text-gray-500">
                    {(activeChat?.supplierRequests.length ?? 0) > 0
                      ? "По выбранным фильтрам запросов не найдено"
                      : "Пока нет запросов поставщикам"}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
          </>
          )}

        </aside>
        ) : null}
      </div>

      {isInviteModalOpen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(30,30,30,0.28)] p-6">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8E8E93]">
                  Пригласить оператора
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
              {inviteManagerOptions.length ? inviteManagerOptions.map((manager) => (
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
                      <span className={`h-2.5 w-2.5 rounded-full ${managerStatusDots[manager.status]}`} />
                      <p className="text-sm font-medium text-[#1E1E1E]">{manager.name}</p>
                    </div>
                    <span className="text-xs text-[#8E8E93]">
                      {managerStatusLabels[manager.status]}
                    </span>
                  </div>
                </button>
              )) : (
                <p className="rounded-2xl bg-[#F7F7FA] px-4 py-3 text-sm text-[#8E8E93]">
                  Нет доступных менеджеров для приглашения
                </p>
              )}
            </div>

            {inviteManagerError && (
              <p className="mt-4 text-sm text-red-500">{inviteManagerError}</p>
            )}

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
                  inviteManagerOptions.find((manager) => manager.id === selectedInvitedManagerId)
                    ?.status !== "online"
                }
                className="rounded-2xl bg-[#0A84FF] px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {isInvitingManager ? "Приглашаем..." : "Пригласить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isJoinActiveDialogConfirmOpen && activeChat ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(30,30,30,0.28)] p-6">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8E8E93]">
                  Подключение к диалогу
                </p>
                <h3 className="mt-2 text-xl font-semibold text-[#1E1E1E]">
                  Чат уже ведёт другой менеджер
                </h3>
              </div>
              <button
                onClick={() => setIsJoinActiveDialogConfirmOpen(false)}
                className="rounded-full bg-[#F2F2F7] px-3 py-2 text-sm text-[#6C6C70]"
              >
                ✕
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-[#5A6270]">
              Сейчас этот диалог ведёт {activeChat.assignedManagerName?.trim() || "другой менеджер"}.
              Вы уверены, что хотите присоединиться к чату и получить возможность писать?
            </p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsJoinActiveDialogConfirmOpen(false)}
                className="rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm text-[#6C6C70]"
              >
                Отмена
              </button>
              <button
                onClick={handleJoinActiveDialog}
                disabled={isInvitingManager}
                className="rounded-2xl bg-[#0A84FF] px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {isInvitingManager ? "Подключаем..." : "Присоединиться"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCreateClientModalOpen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-[rgba(30,30,30,0.28)] p-6">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8E8E93]">
                  Новый клиент
                </p>
                <h3 className="mt-2 text-xl font-semibold text-[#1E1E1E]">
                  Завести клиента в чат
                </h3>
                <p className="mt-1 text-sm text-[#8E8E93]">
                  Обязательные поля: торговая точка и email. Телефон можно добавить позже.
                </p>
              </div>
              <button
                onClick={() => setIsCreateClientModalOpen(false)}
                className="rounded-full bg-[#F2F2F7] px-3 py-2 text-sm text-[#6C6C70]"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                  Торговая точка
                </span>
                <input
                  value={createClientTradePointName}
                  onChange={(event) => setCreateClientTradePointName(event.target.value)}
                  className="w-full rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none placeholder:text-[#8E8E93]"
                  placeholder="Например, Revado"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                  Email
                </span>
                <input
                  value={createClientEmail}
                  onChange={(event) => setCreateClientEmail(event.target.value)}
                  className="w-full rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none placeholder:text-[#8E8E93]"
                  placeholder="client@example.com"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-[12px] font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                  Телефон
                </span>
                <input
                  value={createClientPhone}
                  onChange={(event) => setCreateClientPhone(event.target.value)}
                  className="w-full rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none placeholder:text-[#8E8E93]"
                  placeholder="+7..."
                />
              </label>
            </div>

            {createClientError ? (
              <p className="mt-4 text-sm text-red-500">{createClientError}</p>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsCreateClientModalOpen(false)}
                className="rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm text-[#6C6C70]"
              >
                Отмена
              </button>
              <button
                onClick={handleCreateClientDialog}
                disabled={isCreatingClientDialog}
                className="rounded-2xl bg-[#0A84FF] px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {isCreatingClientDialog ? "Создаём..." : "Создать диалог"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isTransferModalOpen && (
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
              {transferManagerOptions.length ? transferManagerOptions.map((manager) => (
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
                      <span className={`h-2.5 w-2.5 rounded-full ${managerStatusDots[manager.status]}`} />
                      <p className="text-sm font-medium text-[#1E1E1E]">{manager.name}</p>
                    </div>
                    <span className="text-xs text-[#8E8E93]">
                      {managerStatusLabels[manager.status]}
                    </span>
                  </div>
                </button>
              )) : (
                <p className="rounded-2xl bg-[#F7F7FA] px-4 py-3 text-sm text-[#8E8E93]">
                  Нет доступных менеджеров для передачи
                </p>
              )}
            </div>

            {transferDialogError && (
              <p className="mt-4 text-sm text-red-500">{transferDialogError}</p>
            )}

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
                  transferManagerOptions.find((manager) => manager.id === selectedTransferManagerId)
                    ?.status !== "online"
                }
                className="rounded-2xl bg-[#0A84FF] px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {isTransferringDialog ? "Передаём..." : "Передать"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isResolveSupplierConfirmOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[rgba(30,30,30,0.28)] p-6">
          <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.18)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#C1812B]">
                  Поставщик ещё в чате
                </p>
                <h3 className="mt-2 text-xl font-semibold text-[#1E1E1E]">
                  Завершить диалог принудительно?
                </h3>
              </div>
              <button
                onClick={() => setIsResolveSupplierConfirmOpen(false)}
                className="rounded-full bg-[#F2F2F7] px-3 py-2 text-sm text-[#6C6C70]"
              >
                ✕
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-[#6C6C70]">
              По этому обращению есть активный чат с поставщиком
              {activeSupplierRequest?.supplierName ? ` ${activeSupplierRequest.supplierName}` : ""}.
              Если завершить диалог сейчас, чат у поставщика станет неактивным.
              Поставщик сможет снова подключиться только после нового запроса.
            </p>

            {isActiveSupplierRequestPaused ? (
              <p className="mt-3 rounded-2xl bg-[#FFF4DE] px-4 py-3 text-sm text-[#8A5A16]">
                Сейчас поставщик стоит на паузе. Завершение также закроет этот
                поставщицкий запрос.
              </p>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsResolveSupplierConfirmOpen(false)}
                className="rounded-2xl border border-[#D1D1D6] bg-white px-4 py-3 text-sm text-[#6C6C70]"
              >
                Отмена
              </button>
              <button
                onClick={() => void handleResolveTicket(true)}
                disabled={isResolvingTicket}
                className="rounded-2xl bg-[#C1812B] px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                {isResolvingTicket ? "Завершаем..." : "Да, завершить"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isQuickReplyModalOpen && (
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
                  Добавьте свою заготовку, чтобы потом вставлять её в один клик.
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
              placeholder="Например: Уточняю информацию и вернусь к вам через несколько минут."
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
      )}
    </main>
  );
}
