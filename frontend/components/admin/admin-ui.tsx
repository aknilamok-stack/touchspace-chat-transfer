"use client";

import { useEffect, useRef, useState } from "react";

const statusLabels: Record<string, string> = {
  pending: "На проверке",
  approved: "Подтверждён",
  rejected: "Отклонён",
  active: "Активен",
  inactive: "Архив",
  blocked: "Заблокирован",
  pending_approval: "Приглашён",
  new: "Новый",
  in_progress: "В работе",
  waiting_supplier: "Ожидает поставщика",
  waiting_client: "Ожидает клиента",
  resolved: "Решён",
  closed: "Закрыт",
  answered: "Отвечен",
  online: "В сети",
  break: "На перерыве",
  offline: "Не в сети",
};

const roleLabels: Record<string, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  manager_supervisor: "Руководитель менеджеров",
  supplier: "Поставщик",
  supplier_supervisor: "Руководитель поставщика",
  client: "Клиент",
  system: "Система",
};

export const getStatusLabel = (value?: string | null) =>
  value ? (statusLabels[value] ?? value) : "нет данных";

export const getRoleLabel = (value?: string | null) =>
  value ? (roleLabels[value] ?? value) : "нет данных";

export function AdminPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="rounded-[28px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_16px_50px_rgba(148,163,184,0.14)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h2>
            {description ? <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function AdminCards({
  items,
  className,
  dense = false,
}: {
  items: Array<{ label: string; value: string; tone?: "default" | "good" | "warn"; hint?: string }>;
  className?: string;
  dense?: boolean;
}) {
  const toneClass = {
    default: "border-slate-200 bg-white text-slate-950",
    good: "border-emerald-200 bg-emerald-50 text-emerald-950",
    warn: "border-amber-200 bg-amber-50 text-amber-950",
  };

  return (
    <div className={`grid gap-4 md:grid-cols-2 2xl:grid-cols-4 ${className ?? ""}`}>
      {items.map((item, index) => (
        <article
          key={`${item.label}-${index}`}
          className={`rounded-[24px] border shadow-[0_16px_50px_rgba(148,163,184,0.14)] ${
            dense ? "p-4" : "p-5"
          } ${
            toneClass[item.tone ?? "default"]
          }`}
        >
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] opacity-70">
              {item.label}
            </p>
            {item.hint ? (
              <span className="group relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
                !
                <span className="pointer-events-none absolute left-1/2 top-[calc(100%+10px)] z-30 w-[260px] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium leading-5 text-slate-700 opacity-0 shadow-[0_18px_40px_rgba(15,23,42,0.14)] transition group-hover:opacity-100">
                  {item.hint}
                </span>
              </span>
            ) : null}
          </div>
          <p className={`${dense ? "mt-3 text-2xl" : "mt-4 text-3xl"} font-semibold tracking-tight`}>
            {item.value}
          </p>
        </article>
      ))}
    </div>
  );
}

export function AdminPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_50px_rgba(148,163,184,0.14)]">
      <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AdminToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[28px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_16px_50px_rgba(148,163,184,0.14)]">
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function AdminInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <input
      {...props}
      className={`rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white ${
        props.className ?? ""
      }`}
    />
  );
}

export function AdminSelect(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
) {
  return (
    <select
      {...props}
      className={`rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white ${
        props.className ?? ""
      }`}
    />
  );
}

export function AdminPeriodSelect({
  value,
  onChange,
  options = [
    { value: "day", label: "Сегодня" },
    { value: "yesterday", label: "Вчера" },
    { value: "week", label: "Неделя" },
    { value: "month", label: "Месяц" },
    { value: "custom", label: "Произвольный" },
  ],
}: {
  value: string;
  onChange: (value: string) => void;
  options?: Array<{ value: string; label: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative min-w-[170px]">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900 outline-none transition hover:border-sky-200 hover:bg-white focus:border-sky-400"
      >
        <span>{selectedOption?.label ?? "Период"}</span>
        <span className={`text-xs text-slate-500 transition ${isOpen ? "rotate-180" : ""}`}>⌄</span>
      </button>

      {isOpen ? (
        <div className="absolute left-0 top-[calc(100%+8px)] z-40 w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
          {options.map((option) => {
            const active = option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition ${
                  active
                    ? "bg-sky-50 text-sky-800"
                    : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <span className="inline-flex w-4 justify-center text-xs">
                  {active ? "✓" : ""}
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AdminButton({
  children,
  tone = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "danger";
}) {
  const tones = {
    primary: "bg-slate-950 text-white hover:bg-slate-800",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
  };

  return (
    <button
      {...props}
      className={`rounded-2xl px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        tones[tone]
      } ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function AdminStatusBadge({
  value,
}: {
  value: string;
}) {
  const label = getStatusLabel(value);
  const tone =
    value === "approved" || value === "active" || value === "resolved" || value === "online" || label === "Подтверждён" || label === "Активен" || label === "Решён" || label === "В сети"
      ? "bg-emerald-100 text-emerald-800"
      : value === "rejected" || value === "blocked" || value === "offline" || label === "Отклонён" || label === "Заблокирован" || label === "Не в сети"
        ? "bg-rose-100 text-rose-800"
        : value.includes("warn") || value.includes("breach") || value.includes("проср") || value === "pending" || value === "break" || label === "На проверке" || label === "На перерыве"
          ? "bg-amber-100 text-amber-800"
          : "bg-slate-100 text-slate-700";

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}

export function AdminTable({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyTitle,
  emptyDescription,
  renderCell,
  selectedRowKey,
}: {
  columns: Array<{ key: string; label: string }>;
  rows: any[];
  rowKey: (row: any) => string;
  onRowClick?: (row: any) => void;
  emptyTitle: string;
  emptyDescription: string;
  renderCell?: (row: any, key: string) => React.ReactNode;
  selectedRowKey?: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-separate border-spacing-y-3">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className="px-4 text-left text-xs font-semibold uppercase tracking-[0.22em] text-slate-500"
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => {
              const key = rowKey(row);
              const selected = selectedRowKey === key;

              return (
                <tr
                  key={key}
                  onClick={() => onRowClick?.(row)}
                  className={`${
                    onRowClick ? "cursor-pointer" : ""
                  } ${selected ? "bg-sky-50 ring-1 ring-sky-200" : "bg-slate-50 hover:bg-slate-100"}`}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className="px-4 py-4 text-sm text-slate-700 first:rounded-l-2xl first:font-medium first:text-slate-950 last:rounded-r-2xl"
                    >
                      {renderCell ? renderCell(row, column.key) : row[column.key]}
                    </td>
                  ))}
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-6 py-14 text-center">
                <p className="text-lg font-semibold text-slate-900">{emptyTitle}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{emptyDescription}</p>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AdminEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-slate-200 px-6 py-10 text-center">
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}

export function AdminMessage({
  tone = "default",
  children,
}: {
  tone?: "default" | "error" | "success";
  children: React.ReactNode;
}) {
  const classes = {
    default: "border-slate-200 bg-slate-50 text-slate-700",
    error: "border-rose-200 bg-rose-50 text-rose-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };

  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${classes[tone]}`}>{children}</div>
  );
}
