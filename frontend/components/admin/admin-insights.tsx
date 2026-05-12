"use client";

import { useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import {
  AdminButton,
  AdminCards,
  AdminEmpty,
  AdminInput,
  AdminMessage,
  AdminPage,
  AdminPanel,
  AdminPeriodSelect,
  AdminToolbar,
} from "@/components/admin/admin-ui";

type InsightsPayload = {
  summary?: {
    totalDialogs?: number;
    avgDialogsPerDay?: number;
    busiestWeekday?: { label: string; count: number } | null;
    busiestHour?: { label: string; count: number } | null;
    aiDialogs?: number;
    aiShare?: number;
    aiResolved?: number;
    aiHandedToManager?: number;
    aiActivations?: number;
  };
  charts?: {
    byHour?: Array<{ label: string; count: number }>;
    byWeekday?: Array<{ label: string; count: number }>;
  };
  topics?: Array<{ label: string; count: number }>;
  triggers?: Array<{ label: string; count: number }>;
  aiUsage?: {
    topics?: Array<{ label: string; count: number }>;
    triggers?: Array<{ label: string; count: number }>;
  };
};

type AiInsightsPayload = {
  insights?: {
    executiveSummary?: string;
    triggerThemes?: Array<{
      theme: string;
      count: number;
      explanation: string;
    }>;
    recommendations?: string[];
  };
  model?: string;
};

function InsightsBars({
  items,
  accentClass,
}: {
  items: Array<{ label: string; count: number }>;
  accentClass: string;
}) {
  const max = Math.max(...items.map((item) => item.count), 1);

  if (items.length === 0) {
    return (
      <AdminEmpty
        title="Пока нет распределения"
        description="Нужна история диалогов за выбранный период."
      />
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <div key={item.label} className="grid gap-2">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-medium text-slate-900">{item.label}</span>
            <span className="text-slate-500">{item.count}</span>
          </div>
          <div className="h-3 rounded-full bg-slate-100">
            <div
              className={`h-3 rounded-full ${accentClass}`}
              style={{ width: `${Math.max((item.count / max) * 100, item.count > 0 ? 8 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminInsights() {
  const [preset, setPreset] = useState("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [payload, setPayload] = useState<InsightsPayload | null>(null);
  const [aiPayload, setAiPayload] = useState<AiInsightsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  const query = useMemo(
    () => ({
      preset,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    }),
    [preset, dateFrom, dateTo],
  );

  const load = async () => {
    try {
      const result = await adminApi.getInsightsAnalytics(query);
      setPayload(result);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить инсайты");
    }
  };

  const generateAi = async () => {
    try {
      setLoadingAi(true);
      const result = await adminApi.generateInsightsAiSummary(query);
      setAiPayload(result);
      setSuccess("AI-сводка обновлена.");
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось построить AI-инсайты");
    } finally {
      setLoadingAi(false);
    }
  };

  useEffect(() => {
    void load();
  }, [query]);

  return (
    <AdminPage
      title="Инсайты и паттерны обращений"
      description="Раздел для поиска повторяющихся тем, временных пиков и частых триггеров. Здесь админ видит, когда чаще всего пишут, по каким дням идёт пик нагрузки и какие темы начинают доминировать в периоде."
      actions={
        <AdminToolbar>
          <AdminPeriodSelect
            value={preset}
            onChange={setPreset}
            options={[
              { value: "day", label: "Сегодня" },
              { value: "week", label: "Неделя" },
              { value: "month", label: "Месяц" },
            ]}
          />
          <AdminInput
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            aria-label="Дата с"
          />
          <AdminInput
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            aria-label="Дата по"
          />
          <AdminButton tone="secondary" onClick={() => void load()}>
            Обновить
          </AdminButton>
          <AdminButton onClick={() => void generateAi()} disabled={loadingAi}>
            {loadingAi ? "AI анализирует..." : "Сгенерировать AI-инсайты"}
          </AdminButton>
        </AdminToolbar>
      }
    >
      {error ? <AdminMessage tone="error">{error}</AdminMessage> : null}
      {success ? <AdminMessage tone="success">{success}</AdminMessage> : null}

      <AdminCards
        items={[
          { label: "Диалогов в периоде", value: String(payload?.summary?.totalDialogs ?? 0) },
          { label: "Среднее в день", value: String(payload?.summary?.avgDialogsPerDay ?? 0) },
          { label: "Пиковый день недели", value: payload?.summary?.busiestWeekday?.label ?? "нет данных" },
          { label: "Пиковый час", value: payload?.summary?.busiestHour?.label ?? "нет данных", tone: "good" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <AdminPanel title="Когда пишут по времени суток">
          <InsightsBars items={payload?.charts?.byHour ?? []} accentClass="bg-sky-500" />
        </AdminPanel>

        <AdminPanel title="В какие дни недели пишут чаще">
          <InsightsBars items={payload?.charts?.byWeekday ?? []} accentClass="bg-emerald-500" />
        </AdminPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AdminPanel title="Частые темы обращений">
          {(payload?.topics ?? []).length > 0 ? (
            <div className="grid gap-3">
              {payload?.topics?.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                >
                  <span className="text-sm font-medium text-slate-900">{item.label}</span>
                  <span className="text-sm font-semibold text-slate-700">{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <AdminEmpty
              title="Темы пока не выявлены"
              description="Нужны диалоги или AI-категории в выбранном периоде."
            />
          )}
        </AdminPanel>

        <AdminPanel title="Повторяющиеся триггеры">
          {(payload?.triggers ?? []).length > 0 ? (
            <div className="grid gap-3">
              {payload?.triggers?.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-slate-950">{item.label}</p>
                    <p className="text-sm font-semibold text-amber-900">{item.count}</p>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    За период найдено {item.count} обращений по теме «{item.label.toLowerCase()}».
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <AdminEmpty
              title="Триггеры не найдены"
              description="Когда появится больше данных, здесь будут повторяющиеся причины обращений."
            />
          )}
        </AdminPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AdminPanel title="По каким запросам включают AI">
          {(payload?.aiUsage?.topics ?? []).length > 0 ? (
            <div className="grid gap-3">
              {payload?.aiUsage?.topics?.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3"
                >
                  <span className="text-sm font-medium text-slate-900">{item.label}</span>
                  <span className="text-sm font-semibold text-sky-900">{item.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <AdminEmpty
              title="AI пока почти не использовали"
              description="Когда накопятся AI-диалоги, здесь появятся основные темы запросов."
            />
          )}
        </AdminPanel>

        <AdminPanel title="Какие запросы чаще идут через AI">
          {(payload?.aiUsage?.triggers ?? []).length > 0 ? (
            <div className="grid gap-3">
              {payload?.aiUsage?.triggers?.map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-slate-950">{item.label}</p>
                    <p className="text-sm font-semibold text-violet-900">{item.count}</p>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    За период через AI прошло {item.count} обращений по этой теме.
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <AdminEmpty
              title="AI-триггеры пока пусты"
              description="Нужно больше AI-диалогов, чтобы увидеть устойчивые паттерны."
            />
          )}
        </AdminPanel>
      </div>

      <AdminPanel title="AI-сводка по периоду">
        {aiPayload?.insights ? (
          <div className="grid gap-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-sm font-semibold text-slate-950">Короткая управленческая сводка</p>
              <p className="mt-2 text-sm leading-7 text-slate-700">
                {aiPayload.insights.executiveSummary}
              </p>
              <p className="mt-3 text-xs text-slate-400">Модель: {aiPayload.model ?? "не указана"}</p>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-slate-950">Выделенные темы и триггеры</p>
                <div className="mt-3 grid gap-3">
                  {(aiPayload.insights.triggerThemes ?? []).map((item) => (
                    <div
                      key={`${item.theme}-${item.count}`}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-sm font-medium text-slate-950">{item.theme}</p>
                        <p className="text-sm font-semibold text-sky-800">{item.count}</p>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.explanation}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold text-slate-950">Рекомендации</p>
                {(aiPayload.insights.recommendations ?? []).length > 0 ? (
                  <div className="mt-3 grid gap-3">
                    {aiPayload.insights.recommendations?.map((item) => (
                      <div
                        key={item}
                        className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950"
                      >
                        {item}
                      </div>
                    ))}
                  </div>
                ) : (
                  <AdminEmpty
                    title="Рекомендаций пока нет"
                    description="Запусти AI-сводку, когда накопится больше обращений."
                  />
                )}
              </div>
            </div>
          </div>
        ) : (
          <AdminEmpty
            title="AI-сводка ещё не сформирована"
            description="Нажми «Сгенерировать AI-инсайты», чтобы получить краткую управленческую выжимку по периоду."
          />
        )}
      </AdminPanel>
    </AdminPage>
  );
}
