"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/admin-format";
import {
  AdminButton,
  AdminCards,
  AdminInput,
  AdminMessage,
  AdminPage,
  AdminPanel,
  AdminSelect,
  AdminStatusBadge,
  AdminTable,
  AdminToolbar,
  getRoleLabel,
  getStatusLabel,
} from "@/components/admin/admin-ui";

const initialCreateForm = {
  fullName: "",
  email: "",
  role: "manager",
  companyName: "",
  comment: "",
};

export function AdminRegistrations() {
  const [filters, setFilters] = useState({ role: "", status: "" });
  const [payload, setPayload] = useState<any>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [comment, setComment] = useState("");
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [issuedCredentials, setIssuedCredentials] = useState<null | {
    login: string;
    temporaryPassword: string;
  }>(null);

  const loadList = async () => {
    setLoading(true);
    try {
      const result = await adminApi.getRegistrations(filters);
      setPayload(result);
      setError(null);

      const nextSelectedId =
        selectedId && result.items.some((item: any) => item.id === selectedId)
          ? selectedId
          : result.items[0]?.id ?? null;
      setSelectedId(nextSelectedId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить регистрации");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadList();
  }, [filters.role, filters.status]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setComment("");
      return;
    }

    void adminApi
      .getRegistration(selectedId)
      .then((result) => {
        setDetail(result);
        setComment(result.comment ?? "");
      })
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить карточку регистрации");
      });
  }, [selectedId]);

  const metrics = useMemo(
    () => [
      { label: "Всего заявок", value: String(payload?.summary?.total ?? 0) },
      { label: "На проверке", value: String(payload?.summary?.pending ?? 0), tone: "warn" as const },
      { label: "Подтверждены", value: String(payload?.summary?.approved ?? 0), tone: "good" as const },
      { label: "Отклонены", value: String(payload?.summary?.rejected ?? 0) },
    ],
    [payload],
  );

  const handleReview = async (action: "approve" | "reject") => {
    if (!selectedId) {
      return;
    }

    setSubmitting(true);
    try {
      if (action === "approve") {
        const result = await adminApi.approveRegistration(selectedId, { comment });
        setIssuedCredentials(result.credentials ?? null);
        setMessage("Заявка подтверждена. Пользователю выдан доступ.");
      } else {
        await adminApi.rejectRegistration(selectedId, { comment });
        setIssuedCredentials(null);
        setMessage("Заявка отклонена");
      }

      await loadList();
      const updatedDetail = await adminApi.getRegistration(selectedId);
      setDetail(updatedDetail);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось обновить заявку");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await adminApi.createRegistration(createForm);
      setCreateForm(initialCreateForm);
      setMessage("Новая заявка создана");
      await loadList();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось создать заявку");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AdminPage
      title="Регистрации и модерация входа"
      description="Рабочий экран для подтверждения и отклонения новых регистраций менеджеров и поставщиков. Можно сразу создавать демо-заявки для пилотного показа."
    >
      {message ? <AdminMessage tone="success">{message}</AdminMessage> : null}
      {error ? <AdminMessage tone="error">{error}</AdminMessage> : null}
      {issuedCredentials ? (
        <AdminMessage tone="success">
          Логин: <span className="font-semibold">{issuedCredentials.login}</span> · временный пароль:{" "}
          <span className="font-semibold">{issuedCredentials.temporaryPassword}</span>
        </AdminMessage>
      ) : null}

      <AdminCards items={metrics} />

      <AdminToolbar>
        <AdminSelect value={filters.role} onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}>
          <option value="">Все роли</option>
          <option value="manager">Менеджеры</option>
          <option value="supplier">Поставщики</option>
        </AdminSelect>
        <AdminSelect value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
          <option value="">Все статусы</option>
          <option value="pending">На проверке</option>
          <option value="approved">Подтверждены</option>
          <option value="rejected">Отклонены</option>
        </AdminSelect>
        <AdminButton tone="secondary" onClick={() => void loadList()} disabled={loading}>
          Обновить
        </AdminButton>
      </AdminToolbar>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,0.9fr)]">
        <AdminPanel title="Заявки">
          <AdminTable
            columns={[
              { key: "fullName", label: "Имя" },
              { key: "email", label: "Email" },
              { key: "companyName", label: "Компания" },
              { key: "role", label: "Роль" },
              { key: "status", label: "Статус" },
              { key: "createdAt", label: "Дата" },
            ]}
            rows={payload?.items ?? []}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedId(row.id)}
            selectedRowKey={selectedId}
            emptyTitle="Регистраций пока нет"
            emptyDescription="Можно создать демо-заявку прямо из правой панели."
            renderCell={(row, key) => {
              if (key === "status") {
                return <AdminStatusBadge value={row.status} />;
              }

              if (key === "createdAt") {
                return formatDateTime(row.createdAt);
              }

              if (key === "role") {
                return getRoleLabel(row.role);
              }

              return row[key] ?? "нет данных";
            }}
          />
        </AdminPanel>

        <div className="grid gap-4">
          <AdminPanel title="Карточка заявки">
            {detail ? (
              <div className="grid gap-4">
                <div className="grid gap-2 text-sm text-slate-600">
                  <p><span className="font-medium text-slate-950">Имя:</span> {detail.fullName}</p>
                  <p><span className="font-medium text-slate-950">Email:</span> {detail.email}</p>
                  <p><span className="font-medium text-slate-950">Компания:</span> {detail.companyName ?? "нет данных"}</p>
                  <p><span className="font-medium text-slate-950">Роль:</span> {getRoleLabel(detail.role)}</p>
                  <p><span className="font-medium text-slate-950">Статус:</span> {getStatusLabel(detail.status)}</p>
                  <p><span className="font-medium text-slate-950">Создана:</span> {formatDateTime(detail.createdAt)}</p>
                </div>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  rows={4}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-sky-400 focus:bg-white"
                  placeholder="Комментарий или причина отказа"
                />
                <div className="flex gap-3">
                  <AdminButton onClick={() => void handleReview("approve")} disabled={submitting}>
                    Подтвердить
                  </AdminButton>
                  <AdminButton tone="danger" onClick={() => void handleReview("reject")} disabled={submitting}>
                    Отклонить
                  </AdminButton>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Выберите заявку слева.</p>
            )}
          </AdminPanel>

          <AdminPanel title="Создать демо-заявку">
            <form className="grid gap-3" onSubmit={handleCreate}>
              <AdminInput
                value={createForm.fullName}
                onChange={(event) => setCreateForm((current) => ({ ...current, fullName: event.target.value }))}
                placeholder="Имя"
                required
              />
              <AdminInput
                value={createForm.email}
                onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="Email"
                type="email"
                required
              />
              <AdminSelect
                value={createForm.role}
                onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value }))}
              >
                <option value="manager">Менеджер</option>
                <option value="supplier">Поставщик</option>
              </AdminSelect>
              <AdminInput
                value={createForm.companyName}
                onChange={(event) => setCreateForm((current) => ({ ...current, companyName: event.target.value }))}
                placeholder="Компания"
              />
              <AdminInput
                value={createForm.comment}
                onChange={(event) => setCreateForm((current) => ({ ...current, comment: event.target.value }))}
                placeholder="Комментарий"
              />
              <AdminButton type="submit" disabled={submitting}>
                Создать заявку
              </AdminButton>
            </form>
          </AdminPanel>
        </div>
      </div>
    </AdminPage>
  );
}
