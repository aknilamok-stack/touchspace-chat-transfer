type MessageStatusChecksProps = {
  status?: string | null;
  className?: string;
};

export const getMessageStatusLabel = (status?: string | null) => {
  if (status === "read") {
    return "Прочитано";
  }

  if (status === "delivered") {
    return "Доставлено";
  }

  return "Отправлено";
};

export function MessageStatusChecks({
  status,
  className = "",
}: MessageStatusChecksProps) {
  const isRead = status === "read";
  const label = getMessageStatusLabel(status);

  return (
    <span
      className={`inline-flex h-3.5 w-5 shrink-0 items-center justify-center ${className}`}
      title={label}
      aria-label={label}
    >
      <svg
        viewBox="0 0 20 14"
        fill="none"
        className="h-3.5 w-5"
        aria-hidden="true"
      >
        {isRead ? (
          <>
            <path
              d="M2.5 7.4 5.6 10.5 12.1 3.9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8.1 10.5 14.7 3.9"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        ) : (
          <path
            d="M4.4 7.4 7.5 10.5 14.1 3.9"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </span>
  );
}
