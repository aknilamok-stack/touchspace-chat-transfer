"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/admin-format";
import {
  AdminButton,
  AdminInput,
  AdminMessage,
  AdminPanel,
  AdminSelect,
  getStatusLabel,
} from "@/components/admin/admin-ui";

const attentionCards = [
  {
    key: "dialogsWithoutAnswer",
    label: "Диалоги без ответа",
    detail: "дольше 2 минут",
    tone: "bg-rose-50 border-rose-200 text-rose-900",
  },
  {
    key: "supplierOverdue",
    label: "Просрочки поставщика",
    detail: "превышен SLA",
    tone: "bg-amber-50 border-amber-200 text-amber-900",
  },
  {
    key: "pendingRegistrations",
    label: "Регистрации",
    detail: "ждут проверки",
    tone: "bg-sky-50 border-sky-200 text-sky-900",
  },
  {
    key: "systemErrors",
    label: "Системные ошибки",
    detail: "интеграции и сервисы",
    tone: "bg-slate-50 border-slate-200 text-slate-900",
  },
] as const;

const kpiTone: Record<string, string> = {
  default: "border-slate-200 bg-white",
  good: "border-emerald-200 bg-emerald-50/70",
  warn: "border-amber-200 bg-amber-50/80",
};

const teamStatusMeta = {
  online: {
    label: "Онлайн",
    badge: "bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-500",
  },
  break: {
    label: "Перерыв",
    badge: "bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
  },
  offline: {
    label: "Оффлайн",
    badge: "bg-slate-200 text-slate-700",
    dot: "bg-slate-400",
  },
};

const compactEmpty = (text: string) => (
  <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
    {text}
  </p>
);

const periodOptions = [
  { value: "today", label: "Сегодня" },
  { value: "yesterday", label: "Вчера" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "custom", label: "Произвольный" },
];

export function AdminOverview() {
  const [period, setPeriod] = useState("week");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await adminApi.getOverview({
        preset: period === "custom" ? undefined : period,
        dateFrom: period === "custom" ? dateFrom || undefined : undefined,
        dateTo: period === "custom" ? dateTo || undefined : undefined,
      });
      setData(result);
      setUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить обзор");
    }
  };

  useEffect(() => {
    void load();
  }, [period, dateFrom, dateTo]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void load();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [period, dateFrom, dateTo]);

  const kpis = useMemo(
    () => [
      {
        label: "Новые сегодня",
        value: formatNumber(data?.metrics?.dialogsToday),
        hint: "созданы за день",
        tone: "default",
      },
      {
        label: "В работе сейчас",
        value: formatNumber(data?.metrics?.inProgressDialogs),
        hint: "активные диалоги",
        tone: "default",
      },
      {
        label: "Решено сегодня",
        value: formatNumber(data?.metrics?.resolvedToday),
        hint: "решённые и закрытые",
        tone: "good",
      },
      {
        label: "1-й ответ менеджера",
        value: formatDuration(data?.metrics?.avgFirstResponseMs),
        hint: "среднее по системе",
        tone: "default",
      },
      {
        label: "Ответ поставщика",
        value: formatDuration(data?.metrics?.avgSupplierResponseMs),
        hint: "среднее время ответа",
        tone: "default",
      },
      {
        label: "Менеджеров онлайн",
        value: formatNumber(data?.metrics?.onlineManagers),
        hint: "доступны сейчас",
        tone: "good",
      },
    ],
    [data],
  );

  const chartPoints = data?.charts?.dialogsByDay ?? [];
  const maxChartValue = Math.max(...chartPoints.map((item: any) => item.count), 1);
  const activityMetrics = [
    {
      label: "Торговых точек писали",
      value: formatNumber(data?.metrics?.activeTradePoints),
      hint: "хотя бы раз писали в чат",
    },
    {
      label: "Обращений в чат",
      value: formatNumber(data?.metrics?.totalChatRequests),
      hint: "от нового письма до статуса «решён»",
    },
    {
      label: "Всего диалогов",
      value: formatNumber(data?.metrics?.totalDialogs),
      hint: "общий объём системы",
    },
    {
      label: "Запросов поставщикам",
      value: formatNumber(data?.metrics?.totalSupplierRequests),
      hint: "всего запросов поставщикам",
    },
    {
      label: "Среднее чатов в день",
      value: formatNumber(data?.metrics?.avgDialogsPerDay),
      hint: "за выбранный период",
    },
  ];

  return (
    <section className="grid gap-4">
      {error ? <AdminMessage tone="error">{error}</AdminMessage> : null}

      <section className="rounded-[24px] border border-slate-200/80 bg-white/92 px-5 py-4 shadow-[0_16px_40px_rgba(148,163,184,0.14)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-[30px] font-semibold tracking-tight text-slate-950">Главная</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
              <span>Период:</span>
              <AdminSelect
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
                className="rounded-none border-0 bg-transparent px-0 py-0 text-xs font-medium focus:bg-transparent"
                aria-label="Период главной"
              >
                {periodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </AdminSelect>
            </div>
            {period === "custom" ? (
              <>
                <AdminInput
                  type="date"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                  className="rounded-full px-3 py-1.5 text-xs"
                  aria-label="Дата с"
                />
                <AdminInput
                  type="date"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                  className="rounded-full px-3 py-1.5 text-xs"
                  aria-label="Дата по"
                />
              </>
            ) : null}
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800">
              Live: автообновление 10 сек
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
              Обновлено: {formatDateTime(updatedAt)}
            </span>
            <AdminButton tone="secondary" onClick={() => void load()}>
              Обновить
            </AdminButton>
          </div>
        </div>
      </section>

      <AdminPanel title="Требует внимания">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {attentionCards.map((item) => (
            <div key={item.key} className={`rounded-[22px] border px-4 py-4 ${item.tone}`}>
              <p className="text-sm font-medium">{item.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight">
                {formatNumber(data?.attention?.[item.key] ?? 0)}
              </p>
              <p className="mt-2 text-xs opacity-75">{item.detail}</p>
            </div>
          ))}
        </div>
      </AdminPanel>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((item) => (
          <article
            key={item.label}
            className={`rounded-[22px] border px-5 py-5 shadow-[0_10px_28px_rgba(148,163,184,0.08)] ${kpiTone[item.tone]}`}
          >
            <p className="text-sm font-medium text-slate-600">{item.label}</p>
            <p className="mt-4 text-[34px] font-semibold tracking-tight text-slate-950">{item.value}</p>
            <p className="mt-2 text-xs text-slate-500">{item.hint}</p>
          </article>
        ))}
      </section>

      <AdminPanel title="Охват и активность">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {activityMetrics.map((item) => (
            <div key={item.label} className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-medium text-slate-600">{item.label}</p>
              <p className="mt-3 text-[30px] font-semibold tracking-tight text-slate-950">{item.value}</p>
              <p className="mt-2 text-xs text-slate-500">{item.hint}</p>
            </div>
          ))}
        </div>
      </AdminPanel>

      <section className="grid gap-4 2xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
        <AdminPanel title="Проблемные диалоги">
          {(data?.lists?.problematicDialogs ?? []).length > 0 ? (
            <div className="grid gap-3">
              {data.lists.problematicDialogs.map((item: any) => (
                <div
                  key={item.id}
                  className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        Компания: {item.supplierCompanyName ?? item.supplierName ?? "не указана"}
                      </p>
                      <p className="mt-1 text-sm text-slate-700">
                        Поставщик: {item.supplierContactName ?? "не указан"}
                      </p>
                    </div>
                    <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-800">
                      {item.issue}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>Менеджер: {item.managerName}</span>
                    <span>Статус: {getStatusLabel(item.status)}</span>
                    <span>Диалог: {item.title}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            compactEmpty("Сейчас критичных диалогов не найдено.")
          )}
        </AdminPanel>

        <AdminPanel title="Живая команда">
          {(data?.lists?.team ?? []).length > 0 ? (
            <div className="overflow-hidden rounded-[20px] border border-slate-200">
              <div className="grid grid-cols-[minmax(0,1.3fr)_110px_90px_90px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500">
                <span>Менеджер</span>
                <span>Статус</span>
                <span>Диалогов</span>
                <span>SLA-риск</span>
              </div>
              <div className="grid">
                {data.lists.team.map((item: any) => {
                  const meta = teamStatusMeta[item.status as keyof typeof teamStatusMeta] ?? teamStatusMeta.offline;

                  return (
                    <div
                      key={item.id}
                      className="grid grid-cols-[minmax(0,1.3fr)_110px_90px_90px] gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{item.fullName}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.overloaded ? "Есть перегрузка" : "Нагрузка в норме"}
                        </p>
                      </div>
                      <div className="flex items-center">
                        <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium ${meta.badge}`}>
                          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </div>
                      <div className="flex items-center font-medium text-slate-900">{item.dialogs}</div>
                      <div className="flex items-center font-medium text-slate-900">
                        {item.slaRisk > 0 ? item.slaRisk : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            compactEmpty("Когда менеджеры начнут работать в системе, здесь появится живая загрузка команды.")
          )}
        </AdminPanel>
      </section>

      <AdminPanel title="Динамика за 7 дней">
        {chartPoints.length > 0 ? (
          <div className="grid gap-5">
            <div className="grid h-[210px] grid-cols-7 items-end gap-3">
              {chartPoints.map((item: any) => {
                const barHeight = Math.max((item.count / maxChartValue) * 100, item.count > 0 ? 10 : 4);

                return (
                  <div key={item.date} className="flex h-full flex-col justify-end gap-3">
                    <div className="flex-1 rounded-[18px] bg-slate-100 p-2">
                      <div
                        className="w-full rounded-[14px] bg-[linear-gradient(180deg,#0A84FF_0%,#38BDF8_100%)]"
                        style={{ height: `${barHeight}%`, minHeight: item.count > 0 ? "18px" : "6px" }}
                      />
                    </div>
                    <div className="text-center">
                      <p className="text-base font-semibold text-slate-950">{item.count}</p>
                      <p className="text-xs text-slate-500">{item.date.slice(5).replace("-", ".")}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-sm text-slate-500">
              Короткий обзор тренда по входящим диалогам. Детальная аналитика вынесена в отдельные вкладки.
            </p>
          </div>
        ) : (
          compactEmpty("За выбранный период пока нет движения по диалогам.")
        )}
      </AdminPanel>
    </section>
  );
}
