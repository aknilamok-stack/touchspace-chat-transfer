const AVATAR_COLORS = [
  "#FF6B6B",
  "#FF8E3C",
  "#FFB340",
  "#FFD166",
  "#7BC96F",
  "#34C759",
  "#1CC8A0",
  "#21C7D9",
  "#0A84FF",
  "#4D7CFE",
  "#6C63FF",
  "#8B5CF6",
  "#C084FC",
  "#EC4899",
  "#F06292",
  "#A3A3A3",
  "#6B7280",
  "#22A699",
];

const AVATAR_EMOJIS = [
  "🦊",
  "🐺",
  "🐻",
  "🐼",
  "🦉",
  "🦁",
  "🐯",
  "🐨",
  "🦔",
  "🐸",
  "🦋",
  "🐝",
  "🌵",
  "🌿",
  "🍀",
  "🌻",
  "🌷",
  "🍎",
  "🍐",
  "🍊",
  "🍋",
  "🍇",
  "🍒",
  "🥝",
];

const MONTH_NAMES_SHORT = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

const normalizeKey = (value?: string | null) =>
  value?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";

const hashString = (value: string) => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

export const getDialogAvatar = (
  identityKey: string,
  storedColor?: string | null,
  storedEmoji?: string | null
) => {
  if (storedColor && storedEmoji) {
    return {
      color: storedColor,
      emoji: storedEmoji,
    };
  }

  const safeKey = normalizeKey(identityKey) || "touchspace";
  const hash = hashString(safeKey);

  return {
    color: AVATAR_COLORS[hash % AVATAR_COLORS.length],
    emoji: AVATAR_EMOJIS[hash % AVATAR_EMOJIS.length],
  };
};

export const formatDialogActivityLabel = (value?: string | null) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  const timeLabel = date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (date >= startOfToday && date < startOfTomorrow) {
    return `сегодня, ${timeLabel}`;
  }

  if (date >= startOfYesterday && date < startOfToday) {
    return `вчера, ${timeLabel}`;
  }

  return `${date.getDate()} ${MONTH_NAMES_SHORT[date.getMonth()]}, ${timeLabel}`;
};

export const getDialogManagerLabel = (
  assignedManagerName?: string | null,
  lastResolvedByManagerName?: string | null
) => assignedManagerName?.trim() || lastResolvedByManagerName?.trim() || "Не назначен";
