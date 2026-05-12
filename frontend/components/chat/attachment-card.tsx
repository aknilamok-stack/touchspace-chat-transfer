import { formatChatAttachmentSize, getChatAttachmentKind, type ChatAttachmentPayload } from "@/lib/chat-attachments";

type ChatAttachmentCardProps = {
  attachment: ChatAttachmentPayload;
  tone?: "incoming" | "outgoing" | "neutral";
  className?: string;
};

const kindMeta = {
  image: { icon: "🖼", label: "Изображение" },
  pdf: { icon: "📕", label: "PDF" },
  document: { icon: "📘", label: "Документ" },
  spreadsheet: { icon: "📗", label: "Таблица" },
  presentation: { icon: "📙", label: "Презентация" },
  text: { icon: "📝", label: "Текст" },
  file: { icon: "📎", label: "Файл" },
} as const;

const toneStyles = {
  incoming: {
    card: "border-[#DCE4F0] bg-white",
    subcard: "border-[#EEF1F5] bg-[#F7F9FC]",
    primaryText: "text-[#1E1E1E]",
    secondaryText: "text-[#667085]",
    action: "border-[#D9E8FF] bg-[#F5F9FF] text-[#0A84FF] hover:bg-[#EAF3FF]",
  },
  outgoing: {
    card: "border-white/18 bg-white/10",
    subcard: "border-white/12 bg-white/8",
    primaryText: "text-white",
    secondaryText: "text-white/76",
    action: "border-white/18 bg-white/12 text-white hover:bg-white/18",
  },
  neutral: {
    card: "border-slate-200 bg-slate-50",
    subcard: "border-slate-200 bg-white",
    primaryText: "text-slate-900",
    secondaryText: "text-slate-500",
    action: "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
  },
} as const;

export function ChatAttachmentCard({
  attachment,
  tone = "incoming",
  className = "",
}: ChatAttachmentCardProps) {
  const styles = toneStyles[tone];
  const attachmentKind = getChatAttachmentKind(attachment);
  const meta = kindMeta[attachmentKind];
  const extension = attachment.name.includes(".")
    ? attachment.name.split(".").pop()?.toUpperCase()
    : meta.label.toUpperCase();
  const sizeLabel = formatChatAttachmentSize(attachment.size);
  const infoLabel = [meta.label, sizeLabel].filter(Boolean).join(" • ");

  return (
    <div
      className={`mt-2 overflow-hidden rounded-[18px] border ${styles.card} ${className}`.trim()}
    >
      {attachmentKind === "image" ? (
        <a
          href={attachment.url}
          target="_blank"
          rel="noreferrer"
          className={`block border-b ${styles.subcard}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachment.url}
            alt={attachment.name}
            className="max-h-[280px] w-full object-cover"
            loading="lazy"
          />
        </a>
      ) : (
        <div className={`flex items-start gap-3 border-b p-3 ${styles.subcard}`}>
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-black/5 bg-white/70 text-xl">
            <span aria-hidden="true">{meta.icon}</span>
          </div>
          <div className="min-w-0">
            <p className={`truncate text-sm font-semibold ${styles.primaryText}`}>
              {attachment.name}
            </p>
            <p className={`mt-1 text-xs ${styles.secondaryText}`}>
              {extension || meta.label.toUpperCase()}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${styles.primaryText}`}>
            {attachment.name}
          </p>
          {infoLabel ? (
            <p className={`mt-1 text-xs ${styles.secondaryText}`}>{infoLabel}</p>
          ) : null}
          {attachment.caption ? (
            <p className={`mt-2 break-words text-sm ${styles.secondaryText}`}>
              {attachment.caption}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <a
            href={attachment.url}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition ${styles.action}`}
          >
            Открыть
          </a>
          <a
            href={attachment.url}
            download={attachment.name}
            className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-semibold transition ${styles.action}`}
          >
            Скачать
          </a>
        </div>
      </div>
    </div>
  );
}

type ChatAttachmentListProps = {
  attachments: ChatAttachmentPayload[];
  tone?: "incoming" | "outgoing" | "neutral";
  className?: string;
};

export function ChatAttachmentList({
  attachments,
  tone = "incoming",
  className = "",
}: ChatAttachmentListProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={`grid gap-2 ${className}`.trim()}>
      {attachments.map((attachment, index) => (
        <ChatAttachmentCard
          key={`${attachment.url}-${attachment.name}-${index}`}
          attachment={attachment}
          tone={tone}
          className={index === 0 ? "mt-0" : ""}
        />
      ))}
    </div>
  );
}
