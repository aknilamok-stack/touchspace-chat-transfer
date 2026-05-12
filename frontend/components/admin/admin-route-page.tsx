"use client";

import { useEffect, useState } from "react";
import { getAdminRouteData, type AdminRouteData } from "@/lib/admin";

type AdminRoutePageProps = {
  routeKey: string;
};

const toneClasses = {
  default: "border-slate-200 bg-white text-slate-900",
  good: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warn: "border-amber-200 bg-amber-50 text-amber-950",
};

export function AdminRoutePage({ routeKey }: AdminRoutePageProps) {
  const [state, setState] = useState<{
    data: AdminRouteData | null;
    error: string | null;
    loading: boolean;
  }>({
    data: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setState((current) => ({
        ...current,
        loading: true,
      }));

      const result = await getAdminRouteData(routeKey);

      if (cancelled) {
        return;
      }

      setState({
        data: result.data,
        error: result.error,
        loading: false,
      });
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [routeKey]);

  if (state.loading && !state.data) {
    return (
      <section className="grid gap-4">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_16px_50px_rgba(148,163,184,0.12)]">
          <div className="h-3 w-28 rounded-full bg-slate-200" />
          <div className="mt-4 h-10 w-96 max-w-full rounded-full bg-slate-100" />
          <div className="mt-3 h-4 w-full max-w-3xl rounded-full bg-slate-100" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_16px_50px_rgba(148,163,184,0.12)]"
            >
              <div className="h-3 w-24 rounded-full bg-slate-200" />
              <div className="mt-4 h-8 w-20 rounded-full bg-slate-100" />
              <div className="mt-3 h-3 w-32 rounded-full bg-slate-100" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  const data = state.data;

  if (!data) {
    return (
      <section className="rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-rose-900 shadow-[0_16px_50px_rgba(251,113,133,0.14)]">
        <h2 className="text-xl font-semibold">Не удалось подготовить экран</h2>
        <p className="mt-2 text-sm leading-6">
          Маршрут не вернул данные и у него нет fallback-конфига. Проверьте frontend adapter.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <div className="rounded-[28px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_16px_50px_rgba(148,163,184,0.14)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
          {data.eyebrow}
        </p>
        <div className="mt-3 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
              {data.title}
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">{data.description}</p>
          </div>
          {state.error ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Backend недоступен, поэтому показан demo fallback. Ошибка: {state.error}
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Данные загружены из backend admin API.
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <article
            key={metric.label}
            className={`rounded-[24px] border p-5 shadow-[0_16px_50px_rgba(148,163,184,0.14)] ${
              toneClasses[metric.tone ?? "default"]
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] opacity-70">
              {metric.label}
            </p>
            <p className="mt-4 text-3xl font-semibold tracking-tight">{metric.value}</p>
            <p className="mt-3 text-sm opacity-70">{metric.hint ?? "MVP admin metric"}</p>
          </article>
        ))}
      </div>

      <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_50px_rgba(148,163,184,0.14)]">
        <div className="flex flex-wrap gap-3">
          {data.filters.map((filter) => (
            <div
              key={`${filter.label}-${filter.value}`}
              className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700"
            >
              <span className="font-medium text-slate-900">{filter.label}:</span> {filter.value}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
        <div className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_50px_rgba(148,163,184,0.14)]">
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-3">
              <thead>
                <tr>
                  {data.table.columns.map((column) => (
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
                {data.table.rows.length > 0 ? (
                  data.table.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="bg-slate-50">
                      {data.table.columns.map((column) => (
                        <td
                          key={column.key}
                          className="px-4 py-4 text-sm text-slate-700 first:rounded-l-2xl first:font-medium first:text-slate-950 last:rounded-r-2xl"
                        >
                          {row[column.key] ?? "n/a"}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={data.table.columns.length}
                      className="rounded-[24px] border border-dashed border-slate-200 px-6 py-12 text-center"
                    >
                      <p className="text-lg font-semibold text-slate-900">
                        {data.table.emptyTitle}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-slate-500">
                        {data.table.emptyDescription}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-4">
          {data.panels.map((panel) => (
            <aside
              key={panel.title}
              className="rounded-[28px] border border-slate-200/80 bg-white p-5 shadow-[0_16px_50px_rgba(148,163,184,0.14)]"
            >
              <h3 className="text-lg font-semibold text-slate-950">{panel.title}</h3>
              <div className="mt-4 grid gap-3">
                {panel.items.length > 0 ? (
                  panel.items.map((item) => (
                    <div
                      key={`${panel.title}-${item.label}-${item.value}`}
                      className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <p className="text-sm font-medium text-slate-900">{item.label}</p>
                        <p className="text-sm font-semibold text-sky-800">{item.value}</p>
                      </div>
                      {item.meta ? (
                        <p className="mt-2 text-xs leading-5 text-slate-500">{item.meta}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                    Пока нет данных для этого блока.
                  </div>
                )}
              </div>
            </aside>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {data.insights.map((insight) => (
          <section
            key={insight.title}
            className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-6 shadow-[0_16px_50px_rgba(148,163,184,0.14)]"
          >
            <h3 className="text-lg font-semibold text-slate-950">{insight.title}</h3>
            <p className="mt-3 text-sm leading-7 text-slate-600">{insight.description}</p>
          </section>
        ))}
      </div>
    </section>
  );
}
