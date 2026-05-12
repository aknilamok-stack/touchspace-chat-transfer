import { getApiBaseUrl } from "@/lib/api";

export const CHAT_ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_SIZE_MB = Math.round(
  CHAT_ATTACHMENT_MAX_SIZE / (1024 * 1024)
);
export const CHAT_ATTACHMENT_MAX_FILES = 5;
export const CHAT_ATTACHMENT_MAX_TOTAL_SIZE = 5 * 1024 * 1024;
export const CHAT_ATTACHMENT_ACCEPT = [
  "image/*",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".rtf",
  ".csv",
  ".odt",
  ".ods",
  ".odp",
].join(",");

export type ChatAttachmentPayload = {
  url: string;
  name: string;
  caption: string;
  mimeType: string;
  size?: number;
};

const normalizeAttachmentPayload = (payload: {
  url?: string;
  name?: string;
  caption?: string;
  mimeType?: string;
  size?: number;
}): ChatAttachmentPayload | null => {
  if (!payload?.url || !payload?.name) {
    return null;
  }

  return {
    url: payload.url.startsWith("http")
      ? payload.url
      : `${getApiBaseUrl()}${payload.url}`,
    name: payload.name,
    caption: payload.caption || "",
    mimeType: payload.mimeType || "",
    size: typeof payload.size === "number" ? payload.size : undefined,
  };
};

export const parseChatAttachmentPayloads = (content: string): ChatAttachmentPayload[] => {
  try {
    const parsed = JSON.parse(content) as
      | {
          attachments?: Array<{
            url?: string;
            name?: string;
            caption?: string;
            mimeType?: string;
            size?: number;
          }>;
        }
      | {
          url?: string;
          name?: string;
          caption?: string;
          mimeType?: string;
          size?: number;
        };

    if (Array.isArray((parsed as { attachments?: unknown[] }).attachments)) {
      return ((parsed as { attachments: Array<any> }).attachments ?? [])
        .map((attachment) => normalizeAttachmentPayload(attachment))
        .filter((attachment): attachment is ChatAttachmentPayload => Boolean(attachment));
    }

    const singleAttachment = normalizeAttachmentPayload(parsed as any);
    return singleAttachment ? [singleAttachment] : [];
  } catch {
    return [];
  }
};

export const parseChatAttachmentPayload = (content: string): ChatAttachmentPayload | null =>
  parseChatAttachmentPayloads(content)[0] ?? null;

export const formatChatAttachmentSize = (size?: number) => {
  if (!size || Number.isNaN(size)) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const getChatAttachmentKind = (
  attachment: Pick<ChatAttachmentPayload, "mimeType" | "name">
) => {
  const normalizedMime = attachment.mimeType.toLowerCase();
  const extension = attachment.name.split(".").pop()?.toLowerCase() ?? "";

  if (normalizedMime.startsWith("image/")) {
    return "image";
  }

  if (normalizedMime === "application/pdf" || extension === "pdf") {
    return "pdf";
  }

  if (
    normalizedMime.includes("word") ||
    ["doc", "docx", "odt", "rtf"].includes(extension)
  ) {
    return "document";
  }

  if (
    normalizedMime.includes("sheet") ||
    normalizedMime.includes("excel") ||
    ["xls", "xlsx", "csv", "ods"].includes(extension)
  ) {
    return "spreadsheet";
  }

  if (
    normalizedMime.includes("presentation") ||
    ["ppt", "pptx", "odp"].includes(extension)
  ) {
    return "presentation";
  }

  if (normalizedMime.startsWith("text/") || extension === "txt") {
    return "text";
  }

  return "file";
};

export const getChatAttachmentSelectionSummary = (files: File[]) => {
  if (files.length === 0) {
    return "";
  }

  if (files.length === 1) {
    return files[0].name;
  }

  return `${files.length} файлов`;
};

export const validateChatAttachmentFiles = (files: File[]) => {
  if (files.length === 0) {
    return "";
  }

  if (files.length > CHAT_ATTACHMENT_MAX_FILES) {
    return `Можно прикрепить не больше ${CHAT_ATTACHMENT_MAX_FILES} файлов за раз.`;
  }

  if (files.some((file) => file.size > CHAT_ATTACHMENT_MAX_SIZE)) {
    return `Файл больше ${CHAT_ATTACHMENT_MAX_SIZE_MB} МБ. Выберите вложение поменьше.`;
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  if (totalSize > CHAT_ATTACHMENT_MAX_TOTAL_SIZE) {
    return `Суммарный размер вложений в одном сообщении не должен превышать ${CHAT_ATTACHMENT_MAX_SIZE_MB} МБ.`;
  }

  return "";
};
