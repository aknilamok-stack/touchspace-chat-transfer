"use client";

import { useEffect, useMemo, useState } from "react";
import { ChatAttachmentList } from "@/components/chat/attachment-card";
import { adminApi } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import { parseChatAttachmentPayloads } from "@/lib/chat-attachments";
import {
  AdminButton,
  AdminCards,
  AdminInput,
  AdminMessage,
  AdminPage,
  AdminPanel,
  AdminSelect,
  AdminStatusBadge,
  getRoleLabel,
} from "@/components/admin/admin-ui";

const periodOptions = [
  { value: "today", label: "Сегодня" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "custom", label: "Произвольный" },
];

const compactText = (value?: string | null) => {
  if (!value?.trim()) {
    return "нет данных";
  }

  return value.length > 120 ? `${value.slice(0, 120)}...` : value;
};

function MessageBubble({ message }: { message: any }) {
  const attachments = parseChatAttachmentPayloads(message.content);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-slate-900">
          {getRoleLabel(message.senderRole ?? message.senderType)}
        </p>
        <p className="text-xs text-slate-500">{formatDateTime(message.createdAt)}</p>
      </div>
      {attachments.length > 0 ? (
        <ChatAttachmentList attachments={attachments} tone="neutral" className="mt-3" />
      ) : (
        <p className="mt-2 text-sm leading-6 text-slate-700">{message.content}</p>
      )}
    </div>
  );
}

export function AdminDialogs() {
  const [filters, setFilters] = useState({
    status: "",
    supplierEscalated: "",
    slaBreached: "",
    preset: "week",
    dateFrom: "",
    dateTo: "",
  });
  const [payload, setPayload] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [clientAiPayload, setClientAiPayload] = useState<any>(null);
  const [fullDialogOpen, setFullDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const periodQuery = useMemo(
    () => ({
      preset: filters.preset === "custom" ? undefined : filters.preset,
      dateFrom: filters.preset === "custom" ? filters.dateFrom || undefined : undefined,
      dateTo: filters.preset === "custom" ? filters.dateTo || undefined : undefined,
    }),
    [filters.preset, filters.dateFrom, filters.dateTo],
  );

  const loadDialogs = async () => {
    try {
      const result = await adminApi.getDialogs({
        status: filters.status,
        supplierEscalated: filters.supplierEscalated,
        slaBreached: filters.slaBreached,
        ...periodQuery,
      });
      setPayload(result);
      setError(null);
      const nextSelectedId =
        selectedId && result.items.some((item: any) => item.id === selectedId)
          ? selectedId
          : result.items[0]?.id ?? null;
      setSelectedId(nextSelectedId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить диалоги");
    }
  };

  const loadDetail = async (dialogId: string) => {
    try {
      const result = await adminApi.getDialog(dialogId, periodQuery);
      setDetail(result);
      setClientAiPayload(null);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось открыть диалог");
    }
  };

  const generateClientAiSummary = async () => {
    if (!selectedId) {
      return;
    }

    try {
      setAiLoading(true);
      setMessage(null);
      setError(null);
      const result = await adminApi.generateClientDialogAiSummary(selectedId, periodQuery);
      setClientAiPayload(result);
      setMessage("AI-инсайты по клиенту сформированы");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сформировать AI-инсайты");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    void loadDialogs();
  }, [filters.status, filters.supplierEscalated, filters.slaBreached, periodQuery]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }

    void loadDetail(selectedId);
  }, [selectedId, periodQuery]);

  const recentMessages = (detail?.messages ?? []).slice(-6);

  return (
    <AdminPage
      title="Список диалогов"
      description="Read-only просмотр обращений, истории клиента, запросов поставщикам, SLA и AI-инсайтов за выбранный период."
    >
      {message ? <AdminMessage tone="success">{message}</AdminMessage> : null}
      {error ? <AdminMessage tone="error">{error}</AdminMessage> : null}

      <AdminPanel title="Фильтры">
        <div className="flex flex-wrap gap-3">
          <AdminSelect value={filters.preset} onChange={(event) => setFilters((current) => ({ ...current, preset: event.target.value }))}>
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AdminSelect>
          {filters.preset === "custom" ? (
            <>
              <AdminInput
                type="date"
                value={filters.dateFrom}
                onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                aria-label="Дата с"
              />
              <AdminInput
                type="date"
                value={filters.dateTo}
                onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
                aria-label="Дата по"
              />
            </>
          ) : null}
          <AdminSelect value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="">Все статусы</option>
            <option value="new">Новый</option>
            <option value="in_progress">В работе</option>
            <option value="waiting_supplier">Ожидает поставщика</option>
            <option value="waiting_client">Ожидает клиента</option>
            <option value="resolved">Решён</option>
            <option value="closed">Закрыт</option>
          </AdminSelect>
          <AdminSelect value={filters.supplierEscalated} onChange={(event) => setFilters((current) => ({ ...current, supplierEscalated: event.target.value }))}>
            <option value="">Запрос поставщику: все</option>
            <option value="true">Был запрос поставщику</option>
            <option value="false">Без запроса поставщику</option>
          </AdminSelect>
          <AdminSelect value={filters.slaBreached} onChange={(event) => setFilters((current) => ({ ...current, slaBreached: event.target.value }))}>
            <option value="">SLA: все</option>
            <option value="true">Есть нарушение SLA</option>
            <option value="false">Без нарушений SLA</option>
          </AdminSelect>
          <AdminButton tone="secondary" onClick={() => void loadDialogs()}>
            Обновить
          </AdminButton>
        </div>
      </AdminPanel>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.05fr)_minmax(460px,0.95fr)]">
        <AdminPanel title="Все диалоги">
          {(payload?.items ?? []).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-2">
                <thead>
                  <tr>
                    {["Клиент", "Менеджер", "Поставщик", "Статус", "Последнее сообщение", "Флаги"].map((label) => (
                      <th key={label} className="px-4 pb-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payload.items.map((item: any) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`cursor-pointer bg-slate-50 transition hover:bg-sky-50 ${
                        selectedId === item.id ? "outline outline-1 outline-sky-200" : ""
                      }`}
                    >
                      <td className="rounded-l-2xl px-4 py-4">
                        <p className="text-sm font-semibold text-slate-950">{item.clientName}</p>
                        <p className="mt-1 max-w-[260px] text-xs text-slate-500">{compactText(item.lastMessagePreview)}</p>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-700">{item.managerName ?? "не назначен"}</td>
                      <td className="px-4 py-4 text-sm text-slate-700">{item.supplierName ?? "не указан"}</td>
                      <td className="px-4 py-4 text-sm text-slate-700"><AdminStatusBadge value={item.status} /></td>
                      <td className="px-4 py-4 text-sm text-slate-700">{formatDateTime(item.lastMessageAt ?? item.createdAt)}</td>
                      <td className="rounded-r-2xl px-4 py-4 text-sm text-slate-600">
                        {[item.supplierEscalated ? "поставщик" : null, item.slaBreached ? "SLA" : null].filter(Boolean).join(", ") || "нет"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Диалогов за выбранный период нет.
            </p>
          )}
        </AdminPanel>

        <div className="grid gap-4">
          <AdminPanel title={detail ? `Клиент: ${detail.displayClientName}` : "Клиент"}>
            {detail ? (
              <div className="grid gap-4">
                <AdminCards
                  items={[
                    { label: "Диалогов с клиентом", value: String(detail.clientStats?.dialogsTotal ?? 0) },
                    { label: "Завершено", value: String(detail.clientStats?.completedDialogs ?? 0), tone: "good" },
                    { label: "Запросов поставщику", value: String(detail.clientStats?.supplierRequestsCount ?? 0) },
                    { label: "SLA менеджера", value: String(detail.clientStats?.managerSlaBreaches ?? 0), tone: "warn" },
                    { label: "SLA поставщика", value: String(detail.clientStats?.supplierSlaBreaches ?? 0), tone: "warn" },
                  ]}
                />
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                  <p><span className="font-medium text-slate-950">Текущий диалог:</span> {detail.title}</p>
                  <p className="mt-1"><span className="font-medium text-slate-950">Менеджер:</span> {detail.assignedManagerName ?? "не назначен"}</p>
                  <p className="mt-1"><span className="font-medium text-slate-950">Поставщик:</span> {detail.supplierName ?? "не указан"}</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Выберите диалог из списка.</p>
            )}
          </AdminPanel>

          {detail ? (
            <>
              <AdminPanel title="Последние сообщения">
                <div className="grid gap-3">
                  {recentMessages.map((message: any) => (
                    <MessageBubble key={message.id} message={message} />
                  ))}
                  <div className="flex justify-end">
                    <AdminButton tone="secondary" onClick={() => setFullDialogOpen(true)}>
                      Посмотреть весь диалог
                    </AdminButton>
                  </div>
                </div>
              </AdminPanel>

              <AdminPanel title="AI-инсайты по клиенту">
                <div className="grid gap-4">
                  <div className="flex justify-end">
                    <AdminButton onClick={() => void generateClientAiSummary()} disabled={aiLoading}>
                      {aiLoading ? "AI анализирует..." : "Сгенерировать AI-инсайты"}
                    </AdminButton>
                  </div>
                  {clientAiPayload?.insights ? (
                    <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#eef6ff_100%)] px-4 py-4 text-sm text-slate-700">
                      <p className="font-semibold text-slate-950">Сводка</p>
                      <p className="mt-2 leading-6">{clientAiPayload.insights.executiveSummary}</p>
                      {(clientAiPayload.insights.triggerThemes ?? []).length > 0 ? (
                        <div className="mt-4 grid gap-2">
                          {clientAiPayload.insights.triggerThemes.map((item: any) => (
                            <div key={`${item.theme}_${item.count}`} className="rounded-xl bg-white px-3 py-2">
                              <p className="font-medium text-slate-950">{item.theme} · {item.count}</p>
                              <p className="mt-1 text-slate-600">{item.explanation}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {(clientAiPayload.insights.recommendations ?? []).length > 0 ? (
                        <div className="mt-4 grid gap-2">
                          {clientAiPayload.insights.recommendations.map((item: string) => (
                            <p key={item} className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-950">{item}</p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Нажмите кнопку, чтобы получить AI-анализ по выбранному клиенту за период.</p>
                  )}
                </div>
              </AdminPanel>
            </>
          ) : null}
        </div>
      </div>

      {fullDialogOpen && detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
          <div className="max-h-[86vh] w-full max-w-4xl overflow-hidden rounded-[24px] bg-white shadow-[0_30px_80px_rgba(15,23,42,0.3)]">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-lg font-semibold text-slate-950">{detail.displayClientName}</p>
                <p className="mt-1 text-sm text-slate-500">{detail.title}</p>
              </div>
              <AdminButton tone="secondary" onClick={() => setFullDialogOpen(false)}>
                Закрыть
              </AdminButton>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              <div className="grid gap-3">
                {(detail.messages ?? []).map((message: any) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AdminPage>
  );
}
