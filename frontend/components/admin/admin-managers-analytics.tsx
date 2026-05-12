"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { formatDuration, formatDateTime } from "@/lib/admin-format";
import { buildPeriodLabel, buildPeriodQuery, downloadExcelReport } from "@/lib/excel-report";
import {
  AdminButton,
  AdminCards,
  AdminInput,
  AdminMessage,
  AdminPage,
  AdminPanel,
  AdminPeriodSelect,
  AdminStatusBadge,
  AdminTable,
  AdminToolbar,
  getStatusLabel,
} from "@/components/admin/admin-ui";

export function AdminManagersAnalytics() {
  const [preset, setPreset] = useState("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [payload, setPayload] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await adminApi.getManagersAnalytics(buildPeriodQuery({ preset, dateFrom, dateTo }));
      setPayload(result);
      setError(null);
      setSelectedId((current) =>
        current && result.items.some((item: any) => item.id === current)
          ? current
          : result.items[0]?.id ?? null,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить аналитику менеджеров");
    }
  };

  useEffect(() => {
    void load();
  }, [preset, dateFrom, dateTo]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void load();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [preset, dateFrom, dateTo]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    const loadDetail = async () => {
      try {
        const result = await adminApi.getManagerAnalyticsDetail(
          selectedId,
          buildPeriodQuery({ preset, dateFrom, dateTo }),
        );
        setDetail(result);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Не удалось открыть менеджера");
      }
    };

    void loadDetail();

    const intervalId = window.setInterval(() => {
      void loadDetail();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [selectedId, preset, dateFrom, dateTo]);

  const downloadReport = () => {
    const periodLabel = buildPeriodLabel({ preset, dateFrom, dateTo });
    const items = payload?.items ?? [];

    downloadExcelReport(`touchspace-managers-report-${periodLabel}`, [
      {
        title: `Отчет по менеджерам за период: ${periodLabel}`,
        columns: [
          "Менеджер",
          "Компания",
          "Статус",
          "Live",
          "Обработано диалогов",
          "В работе",
          "Среднее время первого ответа",
          "Среднее время закрытия",
          "Средняя оценка",
          "Количество оценок",
          "SLA просрочки",
          "Эскалации поставщикам",
        ],
        rows: items.map((item: any) => [
          item.fullName,
          item.companyName || "",
          getStatusLabel(item.status),
          getStatusLabel(item.presenceStatus),
          item.handledDialogs ?? 0,
          item.dialogsInWork ?? 0,
          formatDuration(item.avgFirstResponseMs),
          formatDuration(item.avgCloseTimeMs),
          item.ratingsCount ? Number(item.avgRating ?? 0).toFixed(1) : "",
          item.ratingsCount ?? 0,
          item.slaBreaches ?? 0,
          item.escalationsToSupplier ?? 0,
        ]),
      },
      {
        title: "Итоги",
        columns: ["Показатель", "Значение"],
        rows: [
          ["Менеджеров в отчете", items.length],
          ["Сейчас online", payload?.livePresence?.online ?? 0],
          ["На перерыве", payload?.livePresence?.break ?? 0],
          ["Не в сети", payload?.livePresence?.offline ?? 0],
          ["Обработано диалогов", items.reduce((sum: number, item: any) => sum + (item.handledDialogs ?? 0), 0)],
          ["SLA просрочки", items.reduce((sum: number, item: any) => sum + (item.slaBreaches ?? 0), 0)],
        ],
      },
    ]);
  };

  return (
    <AdminPage
      title="Аналитика по менеджерам"
      description="Рабочий срез эффективности менеджеров: обработанные и активные диалоги, время первого ответа, просрочки и эскалации к поставщикам."
      actions={
        <AdminToolbar>
          <AdminPeriodSelect value={preset} onChange={setPreset} />
          {preset === "custom" ? (
            <>
              <AdminInput type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              <AdminInput type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </>
          ) : null}
          <AdminButton tone="secondary" onClick={() => void load()}>
            Обновить
          </AdminButton>
          <AdminButton onClick={downloadReport} disabled={!payload}>
            Скачать Excel
          </AdminButton>
        </AdminToolbar>
      }
    >
      {error ? <AdminMessage tone="error">{error}</AdminMessage> : null}

      <AdminCards
        items={[
          { label: "Менеджеров в отчёте", value: String(payload?.items?.length ?? 0) },
          { label: "Сейчас online", value: String(payload?.livePresence?.online ?? 0), tone: "good" },
          { label: "На перерыве", value: String(payload?.livePresence?.break ?? 0), tone: "warn" },
          {
            label: "Обработано диалогов",
            value: String((payload?.items ?? []).reduce((sum: number, item: any) => sum + (item.handledDialogs ?? 0), 0)),
          },
          {
            label: "SLA просрочки",
            value: String((payload?.items ?? []).reduce((sum: number, item: any) => sum + (item.slaBreaches ?? 0), 0)),
            tone: "warn",
          },
        ]}
      />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.3fr)_minmax(420px,0.9fr)]">
        <AdminPanel title="Менеджеры">
          <AdminTable
            columns={[
              { key: "fullName", label: "Менеджер" },
              { key: "presenceStatus", label: "Live" },
              { key: "handledDialogs", label: "Обработано" },
              { key: "dialogsInWork", label: "В работе" },
              { key: "avgFirstResponseMs", label: "1-й ответ" },
              { key: "avgRating", label: "Оценка" },
              { key: "slaBreaches", label: "SLA" },
              { key: "escalationsToSupplier", label: "Эскалации" },
            ]}
            rows={payload?.items ?? []}
            rowKey={(row) => row.id}
            selectedRowKey={selectedId}
            onRowClick={(row) => setSelectedId(row.id)}
            emptyTitle="Нет аналитики по менеджерам"
            emptyDescription="Пока нет данных за выбранный период."
            renderCell={(row, key) => {
              if (key === "presenceStatus") {
                return <AdminStatusBadge value={row.presenceStatus ?? "offline"} />;
              }

              if (key === "avgFirstResponseMs") {
                return formatDuration(row.avgFirstResponseMs);
              }

              if (key === "avgRating") {
                return row.ratingsCount ? `${Number(row.avgRating ?? 0).toFixed(1)} (${row.ratingsCount})` : "—";
              }

              return row[key];
            }}
          />
        </AdminPanel>

        <AdminPanel title="Карточка менеджера">
          {detail ? (
            <div className="grid gap-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                <p><span className="font-medium text-slate-950">Имя:</span> {detail.manager.fullName}</p>
                <p className="mt-1"><span className="font-medium text-slate-950">Статус:</span> <AdminStatusBadge value={detail.manager.status} /></p>
                <p className="mt-1"><span className="font-medium text-slate-950">Live presence:</span> <AdminStatusBadge value={detail.manager.presenceStatus ?? "offline"} /></p>
                <p className="mt-1"><span className="font-medium text-slate-950">Обработано:</span> {detail.metrics.handledDialogs}</p>
                <p className="mt-1"><span className="font-medium text-slate-950">1-й ответ:</span> {formatDuration(detail.metrics.avgFirstResponseMs)}</p>
                <p className="mt-1"><span className="font-medium text-slate-950">Средняя оценка:</span> {detail.metrics.ratingsCount ? `${Number(detail.metrics.avgRating ?? 0).toFixed(1)} (${detail.metrics.ratingsCount})` : "Нет оценок"}</p>
              </div>

              <div className="grid gap-3">
                <p className="text-sm font-semibold text-slate-950">Последние диалоги</p>
                {(detail.dialogs ?? []).map((dialog: any) => (
                  <div key={dialog.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-medium text-slate-900">{dialog.title}</p>
                      <AdminStatusBadge value={dialog.status} />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{formatDateTime(dialog.createdAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Выберите менеджера слева.</p>
          )}
        </AdminPanel>
      </div>
    </AdminPage>
  );
}
