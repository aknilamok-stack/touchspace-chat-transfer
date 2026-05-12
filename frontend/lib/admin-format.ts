export const formatDateTime = (value?: string | null) => {
  if (!value) {
    return "нет данных";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "нет данных";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export const formatDuration = (value?: number | null) => {
  if (typeof value !== "number") {
    return "нет данных";
  }

  if (value < 60_000) {
    return `${Math.round(value / 1000)} сек`;
  }

  const minutes = value / 60_000;

  if (minutes < 60) {
    return `${minutes.toFixed(1)} мин`;
  }

  return `${(minutes / 60).toFixed(1)} ч`;
};

export const formatNumber = (value?: number | null) =>
  new Intl.NumberFormat("ru-RU").format(value ?? 0);
