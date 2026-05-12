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
  AdminSelect,
  AdminStatusBadge,
  AdminTable,
  AdminToolbar,
  getStatusLabel,
} from "@/components/admin/admin-ui";

export function AdminSuppliersAnalytics() {
  const [preset, setPreset] = useState("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [payload, setPayload] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await adminApi.getSuppliersAnalytics({
        ...buildPeriodQuery({ preset, dateFrom, dateTo }),
        companyName,
      });
      setPayload(result);
      setError(null);
      setSelectedId((current) =>
        current && result.items.some((item: any) => item.id === current)
          ? current
          : result.items[0]?.id ?? null,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить аналитику поставщиков");
    }
  };

  useEffect(() => {
    void load();
  }, [preset, dateFrom, dateTo, companyName]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    void adminApi
      .getSupplierAnalyticsDetail(selectedId, buildPeriodQuery({ preset, dateFrom, dateTo }))
      .then((result) => setDetail(result))
      .catch((requestError) =>
        setError(requestError instanceof Error ? requestError.message : "Не удалось открыть поставщика"),
      );
  }, [selectedId, preset, dateFrom, dateTo]);

  const downloadReport = () => {
    const periodLabel = buildPeriodLabel({ preset, dateFrom, dateTo });
    const companyLabel = companyName || "все компании";
    const items = payload?.items ?? [];

    downloadExcelReport(`touchspace-suppliers-report-${periodLabel}-${companyLabel}`, [
      {
        title: `Отчет по поставщикам за период: ${periodLabel}. Компания: ${companyLabel}`,
        columns: [
          "Поставщик",
          "Компания",
          "Статус",
          "Получено запросов",
          "Ответили",
          "Среднее время ответа",
          "SLA просрочки",
          "Связанные диалоги",
        ],
        rows: items.map((item: any) => [
          item.fullName,
          item.companyName || "",
          getStatusLabel(item.status),
          item.receivedRequests ?? 0,
          item.answeredRequests ?? 0,
          formatDuration(item.avgResponseMs),
          item.slaBreaches ?? 0,
          item.relatedDialogs ?? 0,
        ]),
      },
      {
        title: "Итоги",
        columns: ["Показатель", "Значение"],
        rows: [
          ["Поставщиков в отчете", items.length],
          ["Всего запросов", items.reduce((sum: number, item: any) => sum + (item.receivedRequests ?? 0), 0)],
          ["Ответили", items.reduce((sum: number, item: any) => sum + (item.answeredRequests ?? 0), 0)],
          ["SLA просрочки", items.reduce((sum: number, item: any) => sum + (item.slaBreaches ?? 0), 0)],
          ["Связанные диалоги", items.reduce((sum: number, item: any) => sum + (item.relatedDialogs ?? 0), 0)],
        ],
      },
    ]);
  };

  return (
    <AdminPage
      title="Аналитика по поставщикам"
      description="Рабочий срез эффективности поставщиков: сколько запросов получили, сколько ответили и где нарушают SLA."
      actions={
        <AdminToolbar>
          <AdminPeriodSelect value={preset} onChange={setPreset} />
          <AdminSelect value={companyName} onChange={(event) => setCompanyName(event.target.value)}>
            <option value="">Все компании</option>
            {(payload?.companies ?? []).map((company: string) => (
              <option key={company} value={company}>
                {company}
              </option>
            ))}
          </AdminSelect>
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
          { label: "Поставщиков в отчёте", value: String(payload?.items?.length ?? 0) },
          {
            label: "Всего запросов",
            value: String((payload?.items ?? []).reduce((sum: number, item: any) => sum + (item.receivedRequests ?? 0), 0)),
          },
          {
            label: "SLA просрочки",
            value: String((payload?.items ?? []).reduce((sum: number, item: any) => sum + (item.slaBreaches ?? 0), 0)),
            tone: "warn",
          },
        ]}
      />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.3fr)_minmax(420px,0.9fr)]">
        <AdminPanel title={companyName ? `Поставщики компании ${companyName}` : "Поставщики"}>
          <AdminTable
            columns={[
              { key: "fullName", label: "Поставщик" },
              { key: "companyName", label: "Компания" },
              { key: "receivedRequests", label: "Получено" },
              { key: "answeredRequests", label: "Ответили" },
              { key: "avgResponseMs", label: "Средний ответ" },
              { key: "slaBreaches", label: "SLA" },
              { key: "relatedDialogs", label: "Диалоги" },
            ]}
            rows={payload?.items ?? []}
            rowKey={(row) => row.id}
            selectedRowKey={selectedId}
            onRowClick={(row) => setSelectedId(row.id)}
            emptyTitle="Нет аналитики по поставщикам"
            emptyDescription="Пока нет данных за выбранный период."
            renderCell={(row, key) => {
              if (key === "avgResponseMs") {
                return formatDuration(row.avgResponseMs);
              }

              if (key === "companyName") {
                return row.companyName || "не указана";
              }

              return row[key];
            }}
          />
        </AdminPanel>

        <AdminPanel title="Карточка поставщика">
          {detail ? (
            <div className="grid gap-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                <p><span className="font-medium text-slate-950">Имя:</span> {detail.supplier.fullName}</p>
                <p className="mt-1"><span className="font-medium text-slate-950">Компания:</span> {detail.supplier.companyName || "не указана"}</p>
                <p className="mt-1"><span className="font-medium text-slate-950">Статус:</span> <AdminStatusBadge value={detail.supplier.status} /></p>
                <p className="mt-1"><span className="font-medium text-slate-950">Получено:</span> {detail.metrics.receivedRequests}</p>
                <p className="mt-1"><span className="font-medium text-slate-950">Средний ответ:</span> {formatDuration(detail.metrics.avgResponseMs)}</p>
              </div>

              <div className="grid gap-3">
                <p className="text-sm font-semibold text-slate-950">Последние запросы</p>
                {(detail.requests ?? []).map((request: any) => (
                  <div key={request.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-medium text-slate-900">{request.ticket.title}</p>
                      <AdminStatusBadge value={request.status} />
                    </div>
                    <p className="mt-2 leading-6">{request.requestText}</p>
                    <p className="mt-2 text-xs text-slate-500">{formatDateTime(request.createdAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Выберите поставщика слева.</p>
          )}
        </AdminPanel>
      </div>
    </AdminPage>
  );
}
