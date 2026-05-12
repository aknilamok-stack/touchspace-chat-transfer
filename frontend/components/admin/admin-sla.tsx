"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { formatDateTime, formatDuration } from "@/lib/admin-format";
import {
  AdminButton,
  AdminCards,
  AdminMessage,
  AdminPage,
  AdminPanel,
  AdminTable,
} from "@/components/admin/admin-ui";

export function AdminSla() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await adminApi.getSlaSummary();
      setData(result);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить SLA");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <AdminPage
      title="SLA и контроль качества"
      description="Рабочий экран для поиска проблемных диалогов, лидеров по просрочкам и контроля средней скорости ответа по ролям."
      actions={<AdminButton tone="secondary" onClick={() => void load()}>Обновить</AdminButton>}
    >
      {error ? <AdminMessage tone="error">{error}</AdminMessage> : null}

      <AdminCards
        items={[
          { label: "Проблемных диалогов", value: String(data?.summary?.breachedDialogs ?? 0), tone: "warn" },
          { label: "Средний ответ менеджера", value: formatDuration(data?.summary?.avgManagerResponseMs) },
          { label: "Средний ответ поставщика", value: formatDuration(data?.summary?.avgSupplierResponseMs) },
          { label: "Требуют разбора", value: String(data?.problemDialogs?.length ?? 0), tone: "warn" },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <AdminPanel title="Проблемные диалоги">
          <AdminTable
            columns={[
              { key: "id", label: "Диалог" },
              { key: "assignedManagerName", label: "Менеджер" },
              { key: "supplierName", label: "Поставщик" },
              { key: "status", label: "Статус" },
              { key: "lastMessageAt", label: "Последнее сообщение" },
            ]}
            rows={data?.problemDialogs ?? []}
            rowKey={(row) => row.id}
            emptyTitle="SLA-рисков пока нет"
            emptyDescription="Как только появятся нарушения, они будут показаны здесь."
            renderCell={(row, key) => {
              if (key === "lastMessageAt") {
                return formatDateTime(row.lastMessageAt);
              }

              return row[key] ?? "нет данных";
            }}
          />
        </AdminPanel>

        <div className="grid gap-4">
          <AdminPanel title="Менеджеры с просрочками">
            <div className="grid gap-3">
              {(data?.topManagers ?? []).map((item: any) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-slate-900">{item.name}</p>
                    <p className="text-sm font-semibold text-amber-800">{item.breaches}</p>
                  </div>
                </div>
              ))}
            </div>
          </AdminPanel>

          <AdminPanel title="Поставщики с просрочками">
            <div className="grid gap-3">
              {(data?.topSuppliers ?? []).map((item: any) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-slate-900">{item.name}</p>
                    <p className="text-sm font-semibold text-amber-800">{item.breaches}</p>
                  </div>
                </div>
              ))}
            </div>
          </AdminPanel>
        </div>
      </div>
    </AdminPage>
  );
}
