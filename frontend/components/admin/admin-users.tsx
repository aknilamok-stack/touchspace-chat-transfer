"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { formatDateTime, formatNumber } from "@/lib/admin-format";
import {
  AdminButton,
  AdminInput,
  AdminMessage,
  AdminPage,
  AdminSelect,
  AdminStatusBadge,
  getRoleLabel,
} from "@/components/admin/admin-ui";

type InternalRole =
  | "admin"
  | "manager"
  | "manager_supervisor"
  | "supplier"
  | "supplier_supervisor";

type UserStatus = "active" | "blocked" | "pending_approval" | "inactive";

type DrawerMode = "create" | "edit";

const roleOptions: Array<{ value: InternalRole; label: string }> = [
  { value: "manager", label: "Менеджер" },
  { value: "manager_supervisor", label: "Руководитель менеджеров" },
  { value: "supplier", label: "Поставщик" },
  { value: "supplier_supervisor", label: "Руководитель поставщика" },
  { value: "admin", label: "Администратор" },
];

const statusOptions: Array<{ value: UserStatus; label: string }> = [
  { value: "active", label: "Активен" },
  { value: "blocked", label: "Заблокирован" },
  { value: "pending_approval", label: "Приглашён" },
  { value: "inactive", label: "Архив" },
];

const quickRoleFilters = [
  { label: "Все", value: "" },
  { label: "Менеджеры", value: "manager" },
  { label: "Поставщики", value: "supplier" },
  { label: "Админы", value: "admin" },
  { label: "Заблокированные", value: "blocked", kind: "status" as const },
];

const emptyCreateForm = {
  fullName: "",
  email: "",
  role: "manager" as InternalRole,
  companyName: "",
  status: "active" as UserStatus,
};

const emptyEditForm = {
  fullName: "",
  email: "",
  role: "manager" as InternalRole,
  companyName: "",
  status: "active" as UserStatus,
};

const roleNeedsCompany = (role?: string | null) =>
  role === "supplier" || role === "supplier_supervisor";

const roleUsesSupervisorCompanySelect = (role?: string | null) => role === "supplier";

const roleNeedsName = (_role?: string | null) => true;

const getInviteCount = (items: any[]) =>
  items.filter((item) => item.status === "pending_approval" || !item.lastLoginAt).length;

const getStatusActionLabel = (status: UserStatus) => {
  if (status === "blocked") {
    return "Разблокировать";
  }

  return "Заблокировать";
};

export function AdminUsers() {
  const [filters, setFilters] = useState({
    query: "",
    role: "",
    status: "",
    company: "",
  });
  const [payload, setPayload] = useState<any>(null);
  const [companyOptions, setCompanyOptions] = useState<string[]>([]);
  const [supplierSupervisorCompanies, setSupplierSupervisorCompanies] = useState<string[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("create");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [openActionsUserId, setOpenActionsUserId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [editForm, setEditForm] = useState(emptyEditForm);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [deletingUser, setDeletingUser] = useState(false);
  const [issuedCredentials, setIssuedCredentials] = useState<null | {
    login: string;
    temporaryPassword: string;
    passwordChangeRequired?: boolean;
  }>(null);
  const [credentialsCopied, setCredentialsCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<null | {
    id: string;
    fullName: string;
    email?: string | null;
  }>(null);

  const loadUsers = async () => {
    try {
      const result = await adminApi.getUsers({
        role: filters.role,
        status: filters.status,
        company: filters.company,
      });
      setPayload(result);
      setError(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить пользователей");
    }
  };

  const loadSupplierSupervisorCompanies = async () => {
    try {
      const result = await adminApi.getUsers({
        role: "supplier_supervisor",
      });

      const companies = Array.from(
        new Set<string>(
          (result?.items ?? [])
            .map((item: any) => item.companyName?.trim())
            .filter((value: string | undefined | null): value is string => Boolean(value)),
        ),
      ).sort((left, right) => left.localeCompare(right, "ru"));

      setSupplierSupervisorCompanies(companies);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить компании поставщиков");
    }
  };

  const loadCompanyOptions = async () => {
    try {
      const result = await adminApi.getUsers();
      const companies = Array.from(
        new Set<string>(
          (result?.items ?? [])
            .map((item: any) => item.companyName?.trim())
            .filter((value: string | undefined | null): value is string => Boolean(value)),
        ),
      ).sort((left, right) => left.localeCompare(right, "ru"));

      setCompanyOptions(companies);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить список компаний");
    }
  };

  const openCreateDrawer = () => {
    setDrawerMode("create");
    setCreateForm(emptyCreateForm);
    setEditingUserId(null);
    setDetail(null);
    setDrawerOpen(true);
    setMessage(null);
    setError(null);
    setIssuedCredentials(null);
    setCredentialsCopied(false);
  };

  const openEditDrawer = async (userId: string) => {
    setDrawerMode("edit");
    setDrawerOpen(true);
    setEditingUserId(userId);
    setMessage(null);
    setError(null);
    setIssuedCredentials(null);
    setCredentialsCopied(false);

    try {
      const result = await adminApi.getUser(userId);
      setDetail(result);
      setEditForm({
        fullName: result.fullName ?? "",
        email: result.email ?? result.authLogin ?? "",
        role: result.role ?? "manager",
        companyName: result.companyName ?? "",
        status: result.status ?? "active",
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось открыть пользователя");
      setDrawerOpen(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [filters.role, filters.status, filters.company]);

  useEffect(() => {
    void loadSupplierSupervisorCompanies();
    void loadCompanyOptions();
  }, []);

  const users = useMemo(() => {
    const items = payload?.items ?? [];
    const query = filters.query.trim().toLowerCase();

    if (!query) {
      return items;
    }

    return items.filter((item: any) =>
      [item.fullName, item.email, item.authLogin, item.companyName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [payload, filters.query]);

  const metrics = useMemo(
    () => [
      { label: "Всего пользователей", value: formatNumber(payload?.total ?? 0) },
      {
        label: "Активные",
        value: formatNumber((payload?.items ?? []).filter((item: any) => item.status === "active").length),
        tone: "good" as const,
      },
      {
        label: "Заблокированные",
        value: formatNumber((payload?.items ?? []).filter((item: any) => item.status === "blocked").length),
        tone: "warn" as const,
      },
      {
        label: "Приглашённые / без входа",
        value: formatNumber(getInviteCount(payload?.items ?? [])),
      },
    ],
    [payload],
  );

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      const result = await adminApi.createUser({
        fullName: createForm.fullName,
        email: createForm.email,
        role: createForm.role,
        companyName: roleNeedsCompany(createForm.role) ? createForm.companyName : undefined,
        status: createForm.status,
      });

      setIssuedCredentials(result.credentials ?? null);
      setMessage("Пользователь добавлен");
      setDrawerOpen(false);
      setCreateForm(emptyCreateForm);
      await loadUsers();
      await loadSupplierSupervisorCompanies();
      await loadCompanyOptions();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось создать пользователя");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!editingUserId) {
      return;
    }

    setSubmitting(true);
    setMessage(null);
    setError(null);

    try {
      await adminApi.updateUser(editingUserId, {
        fullName: editForm.fullName,
        email: editForm.email,
        role: editForm.role,
        status: editForm.status,
        companyName: roleNeedsCompany(editForm.role) ? editForm.companyName : null,
      });

      const updated = await adminApi.getUser(editingUserId);
      setDetail(updated);
      setEditForm({
        fullName: updated.fullName ?? "",
        email: updated.email ?? updated.authLogin ?? "",
        role: updated.role ?? "manager",
        companyName: updated.companyName ?? "",
        status: updated.status ?? "active",
      });
      setMessage("Изменения сохранены");
      await loadUsers();
      await loadSupplierSupervisorCompanies();
      await loadCompanyOptions();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось обновить пользователя");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!editingUserId) {
      return;
    }

    setResettingPassword(true);
    setMessage(null);
    setError(null);

    try {
      const result = await adminApi.reissueUserPassword(editingUserId);
      setIssuedCredentials(result.credentials ?? null);
      setMessage("Пароль сброшен");
      const updated = await adminApi.getUser(editingUserId);
      setDetail(updated);
      await loadUsers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сбросить пароль");
    } finally {
      setResettingPassword(false);
    }
  };

  const handleQuickStatusToggle = async (user: any) => {
    const nextStatus: UserStatus = user.status === "blocked" ? "active" : "blocked";

    try {
      await adminApi.updateUser(user.id, { status: nextStatus });
      setMessage(nextStatus === "blocked" ? "Пользователь заблокирован" : "Пользователь разблокирован");
      await loadUsers();
      setOpenActionsUserId(null);

      if (editingUserId === user.id && drawerOpen) {
        await openEditDrawer(user.id);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось изменить статус");
    }
  };

  const handleArchive = async (user: any) => {
    try {
      await adminApi.updateUser(user.id, { status: "inactive" });
      setMessage("Пользователь переведён в архив");
      await loadUsers();
      setOpenActionsUserId(null);

      if (editingUserId === user.id && drawerOpen) {
        await openEditDrawer(user.id);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось архивировать пользователя");
    }
  };

  const requestDeleteUser = (user: any) => {
    setOpenActionsUserId(null);
    setDeleteTarget({
      id: user.id,
      fullName: user.fullName ?? "Без имени",
      email: user.email ?? user.authLogin ?? null,
    });
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) {
      return;
    }

    setDeletingUser(true);
    setMessage(null);
    setError(null);

    try {
      await adminApi.deleteUser(deleteTarget.id);
      setMessage("Учётная запись удалена");

      if (editingUserId === deleteTarget.id) {
        setDrawerOpen(false);
        setEditingUserId(null);
        setDetail(null);
      }

      setDeleteTarget(null);
      await loadUsers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось удалить пользователя");
    } finally {
      setDeletingUser(false);
    }
  };

  const handleCopyIssuedCredentials = async () => {
    if (!issuedCredentials || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        `Логин: ${issuedCredentials.login}\nВременный пароль: ${issuedCredentials.temporaryPassword}`,
      );
      setCredentialsCopied(true);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "Не удалось скопировать данные");
    }
  };

  return (
    <AdminPage
      title="Пользователи и доступы"
      description="Добавление, редактирование, блокировка и управление ролями в системе TouchSpace."
      actions={
        <AdminButton onClick={openCreateDrawer}>
          Добавить пользователя
        </AdminButton>
      }
    >
      {message ? <AdminMessage tone="success">{message}</AdminMessage> : null}
      {error ? <AdminMessage tone="error">{error}</AdminMessage> : null}
      {issuedCredentials ? (
        <AdminMessage tone="success">
          Логин: <span className="font-semibold">{issuedCredentials.login}</span> · временный пароль:{" "}
          <span className="font-semibold">{issuedCredentials.temporaryPassword}</span>. Показывается один раз, сохраните и передайте пользователю.
        </AdminMessage>
      ) : null}

      <section className="grid gap-3 xl:grid-cols-4">
        {metrics.map((item) => {
          const toneClass = {
            default: "border-slate-200 bg-white text-slate-950",
            good: "border-emerald-200 bg-emerald-50 text-emerald-950",
            warn: "border-amber-200 bg-amber-50 text-amber-950",
          }[item.tone ?? "default"];

          return (
            <article
              key={item.label}
              className={`rounded-[20px] border px-4 py-4 shadow-[0_12px_32px_rgba(148,163,184,0.1)] ${toneClass}`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-70">
                {item.label}
              </p>
              <p className="mt-3 text-[30px] font-semibold tracking-tight">{item.value}</p>
            </article>
          );
        })}
      </section>

      <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_44px_rgba(148,163,184,0.12)]">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_180px_180px_180px_auto]">
          <AdminInput
            value={filters.query}
            onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
            placeholder="Поиск по имени, email или компании"
          />
          <AdminSelect
            value={filters.role}
            onChange={(event) => setFilters((current) => ({ ...current, role: event.target.value }))}
          >
            <option value="">Все роли</option>
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AdminSelect>
          <AdminSelect
            value={filters.status}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
          >
            <option value="">Все статусы</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AdminSelect>
          <AdminSelect
            value={filters.company}
            onChange={(event) => setFilters((current) => ({ ...current, company: event.target.value }))}
          >
            <option value="">Все компании</option>
            {companyOptions.map((companyName) => (
              <option key={companyName} value={companyName}>
                {companyName}
              </option>
            ))}
          </AdminSelect>
          <AdminButton
            tone="secondary"
            onClick={() => {
              setFilters({
                query: "",
                role: "",
                status: "",
                company: "",
              });
            }}
          >
            Сбросить фильтры
          </AdminButton>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {quickRoleFilters.map((chip) => {
            const active =
              chip.kind === "status"
                ? filters.status === chip.value
                : filters.role === chip.value && filters.status === "";

            return (
              <button
                key={`${chip.kind ?? "role"}_${chip.label}`}
                type="button"
                onClick={() =>
                  chip.kind === "status"
                    ? setFilters((current) => ({ ...current, status: chip.value, role: "" }))
                    : setFilters((current) => ({ ...current, role: chip.value, status: "" }))
                }
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  active
                    ? "border-sky-200 bg-sky-50 text-sky-800"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_16px_44px_rgba(148,163,184,0.12)]">
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2">
            <thead>
              <tr>
                {["Имя", "Email", "Роль", "Компания", "Статус", "Последний вход", "Действия"].map((label) => (
                  <th
                    key={label}
                    className="px-4 pb-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.length > 0 ? (
                users.map((user: any) => (
                  <tr key={user.id} className="bg-slate-50">
                    <td className="rounded-l-2xl px-4 py-4">
                      <button
                        type="button"
                        onClick={() => void openEditDrawer(user.id)}
                        className="text-left"
                      >
                        <p className="font-medium text-slate-950">{user.fullName}</p>
                      </button>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">{user.email ?? user.authLogin ?? "нет данных"}</td>
                    <td className="px-4 py-4 text-sm text-slate-700">{getRoleLabel(user.role)}</td>
                    <td className="px-4 py-4 text-sm text-slate-700">{user.companyName ?? "—"}</td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      <AdminStatusBadge value={user.status} />
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "ещё не входил"}
                    </td>
                    <td className="relative rounded-r-2xl px-4 py-4">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenActionsUserId((current) => (current === user.id ? null : user.id))
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-xl leading-none text-slate-700 transition hover:bg-slate-200"
                        aria-label={`Действия пользователя ${user.fullName}`}
                      >
                        ⋯
                      </button>
                      {openActionsUserId === user.id ? (
                        <div className="absolute right-4 top-14 z-20 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_48px_rgba(15,23,42,0.16)]">
                          <button
                            type="button"
                            onClick={() => {
                              setOpenActionsUserId(null);
                              void openEditDrawer(user.id);
                            }}
                            className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-800 transition hover:bg-slate-100"
                          >
                            Открыть
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleQuickStatusToggle(user)}
                            className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-800 transition hover:bg-slate-100"
                          >
                            {getStatusActionLabel(user.status)}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleArchive(user)}
                            className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-800 transition hover:bg-slate-100"
                          >
                            Архивировать
                          </button>
                          <button
                            type="button"
                            onClick={() => requestDeleteUser(user)}
                            className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-rose-700 transition hover:bg-rose-50"
                          >
                            Удалить
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center">
                    <p className="text-lg font-semibold text-slate-900">Пользователи не найдены</p>
                    <p className="mt-2 text-sm text-slate-500">
                      Попробуй изменить фильтры или добавь нового пользователя.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 bg-slate-950/18 backdrop-blur-[1px]">
          <div className="absolute inset-y-0 right-0 w-full max-w-[560px] overflow-y-auto border-l border-slate-200 bg-white shadow-[0_30px_70px_rgba(15,23,42,0.18)]">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-6 py-5 backdrop-blur">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-950">
                    {drawerMode === "create" ? "Добавить пользователя" : "Карточка пользователя"}
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {drawerMode === "create"
                      ? "Создание аккаунта и выдача доступа в систему."
                      : "Редактирование ролей, статуса и данных доступа."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Закрыть
                </button>
              </div>
            </div>

            <div className="px-6 py-6">
              {drawerMode === "create" ? (
                <form className="grid gap-5" onSubmit={handleCreate}>
                  <section className="grid gap-3">
                    <p className="text-sm font-semibold text-slate-900">Основное</p>
                    {roleNeedsName(createForm.role) ? (
                      <AdminInput
                        value={createForm.fullName}
                        onChange={(event) =>
                          setCreateForm((current) => ({ ...current, fullName: event.target.value }))
                        }
                        placeholder="Имя"
                        required
                      />
                    ) : null}
                    <AdminInput
                      value={createForm.email}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, email: event.target.value }))
                      }
                      placeholder="Email"
                      type="email"
                      required
                    />
                    <AdminSelect
                      value={createForm.role}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          role: event.target.value as InternalRole,
                          companyName: roleNeedsCompany(event.target.value)
                            ? roleUsesSupervisorCompanySelect(event.target.value)
                              ? current.companyName && supplierSupervisorCompanies.includes(current.companyName)
                                ? current.companyName
                                : supplierSupervisorCompanies[0] ?? ""
                              : current.companyName
                            : "",
                        }))
                      }
                    >
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </AdminSelect>
                  </section>

                  <section className="grid gap-3">
                    <p className="text-sm font-semibold text-slate-900">Доступ</p>
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                      Временный пароль сгенерируется автоматически на сервере. Администратор увидит его один раз после создания пользователя.
                    </div>
                  </section>

                  {roleNeedsCompany(createForm.role) ? (
                    <section className="grid gap-3">
                      <p className="text-sm font-semibold text-slate-900">Компания</p>
                      {roleUsesSupervisorCompanySelect(createForm.role) ? (
                        <>
                          <AdminSelect
                            value={createForm.companyName}
                            onChange={(event) =>
                              setCreateForm((current) => ({ ...current, companyName: event.target.value }))
                            }
                            required
                            disabled={supplierSupervisorCompanies.length === 0}
                          >
                            {supplierSupervisorCompanies.length === 0 ? (
                              <option value="">Сначала создайте руководителя поставщика</option>
                            ) : null}
                            {supplierSupervisorCompanies.length > 0 ? (
                              <>
                                <option value="">Выберите компанию</option>
                                {supplierSupervisorCompanies.map((companyName) => (
                                  <option key={companyName} value={companyName}>
                                    {companyName}
                                  </option>
                                ))}
                              </>
                            ) : null}
                          </AdminSelect>
                          <p className="text-xs text-slate-500">
                            Для поставщика доступны только компании, у которых уже создан руководитель поставщика.
                          </p>
                        </>
                      ) : (
                        <AdminInput
                          value={createForm.companyName}
                          onChange={(event) =>
                            setCreateForm((current) => ({ ...current, companyName: event.target.value }))
                          }
                          placeholder="Компания"
                          required
                        />
                      )}
                    </section>
                  ) : null}

                  <section className="grid gap-3">
                    <p className="text-sm font-semibold text-slate-900">Статус</p>
                    <AdminSelect
                      value={createForm.status}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          status: event.target.value as UserStatus,
                        }))
                      }
                    >
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </AdminSelect>
                  </section>

                  <div className="flex gap-3 pt-2">
                    <AdminButton type="submit" disabled={submitting}>
                      Сохранить
                    </AdminButton>
                    <AdminButton type="button" tone="secondary" onClick={() => setDrawerOpen(false)}>
                      Отмена
                    </AdminButton>
                  </div>
                </form>
              ) : detail ? (
                <form className="grid gap-5" onSubmit={handleUpdate}>
                  <section className="grid gap-3">
                    <p className="text-sm font-semibold text-slate-900">Основное</p>
                    <AdminInput
                      value={editForm.fullName}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, fullName: event.target.value }))
                      }
                      placeholder="Имя"
                      required
                    />
                    <AdminInput
                      value={editForm.email}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, email: event.target.value }))
                      }
                      placeholder="Email"
                      type="email"
                      required
                    />
                    <AdminSelect
                      value={editForm.role}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          role: event.target.value as InternalRole,
                          companyName: roleNeedsCompany(event.target.value)
                            ? roleUsesSupervisorCompanySelect(event.target.value)
                              ? current.companyName && supplierSupervisorCompanies.includes(current.companyName)
                                ? current.companyName
                                : supplierSupervisorCompanies[0] ?? ""
                              : current.companyName
                            : "",
                        }))
                      }
                    >
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </AdminSelect>
                  </section>

                  {roleNeedsCompany(editForm.role) ? (
                    <section className="grid gap-3">
                      <p className="text-sm font-semibold text-slate-900">Компания</p>
                      {roleUsesSupervisorCompanySelect(editForm.role) ? (
                        <>
                          <AdminSelect
                            value={editForm.companyName}
                            onChange={(event) =>
                              setEditForm((current) => ({ ...current, companyName: event.target.value }))
                            }
                            required
                            disabled={supplierSupervisorCompanies.length === 0}
                          >
                            {supplierSupervisorCompanies.length === 0 ? (
                              <option value="">Сначала создайте руководителя поставщика</option>
                            ) : null}
                            {supplierSupervisorCompanies.length > 0 ? (
                              <>
                                <option value="">Выберите компанию</option>
                                {supplierSupervisorCompanies.map((companyName) => (
                                  <option key={companyName} value={companyName}>
                                    {companyName}
                                  </option>
                                ))}
                              </>
                            ) : null}
                          </AdminSelect>
                          <p className="text-xs text-slate-500">
                            Для поставщика доступны только компании, у которых уже создан руководитель поставщика.
                          </p>
                        </>
                      ) : (
                        <AdminInput
                          value={editForm.companyName}
                          onChange={(event) =>
                            setEditForm((current) => ({ ...current, companyName: event.target.value }))
                          }
                          placeholder="Компания"
                          required
                        />
                      )}
                    </section>
                  ) : null}

                  <section className="grid gap-3">
                    <p className="text-sm font-semibold text-slate-900">Статус</p>
                    <AdminSelect
                      value={editForm.status}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          status: event.target.value as UserStatus,
                        }))
                      }
                    >
                      {statusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </AdminSelect>
                  </section>

                  <section className="grid gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">Доступ</p>
                      <div className="flex flex-wrap gap-2">
                        <AdminButton
                          type="button"
                          tone="secondary"
                          onClick={() => void handleResetPassword()}
                          disabled={resettingPassword}
                        >
                          Сбросить пароль
                        </AdminButton>
                        <AdminButton
                          type="button"
                          tone="danger"
                          onClick={() =>
                            requestDeleteUser({
                              id: detail.id,
                              fullName: detail.fullName,
                              email: detail.email ?? detail.authLogin ?? null,
                            })
                          }
                        >
                          Удалить учётную запись
                        </AdminButton>
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                      <p>
                        <span className="font-medium text-slate-950">Дата создания:</span>{" "}
                        {formatDateTime(detail.createdAt)}
                      </p>
                      <p className="mt-2">
                        <span className="font-medium text-slate-950">Последний вход:</span>{" "}
                        {detail.lastLoginAt ? formatDateTime(detail.lastLoginAt) : "ещё не входил"}
                      </p>
                      <p className="mt-2">
                        <span className="font-medium text-slate-950">Кем создан:</span>{" "}
                        {detail.createdByAdminId ?? "нет данных"}
                      </p>
                      <p className="mt-2">
                        <span className="font-medium text-slate-950">Логин:</span>{" "}
                        {detail.authLogin ?? detail.email ?? "нет данных"}
                      </p>
                      <p className="mt-2">
                        <span className="font-medium text-slate-950">Требуется смена пароля:</span>{" "}
                        {detail.passwordChangeRequired ? "да" : "нет"}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        После сброса пароля пользователь будет принудительно выведен из всех активных сессий.
                      </p>
                    </div>
                  </section>

                  <div className="flex gap-3 pt-2">
                    <AdminButton type="submit" disabled={submitting}>
                      Сохранить
                    </AdminButton>
                    <AdminButton type="button" tone="secondary" onClick={() => setDrawerOpen(false)}>
                      Отмена
                    </AdminButton>
                  </div>
                </form>
              ) : (
                <p className="text-sm text-slate-500">Карточка пользователя загружается.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {issuedCredentials ? (
        <div className="fixed inset-0 z-50 bg-slate-950/26 backdrop-blur-[2px]">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="w-full max-w-[560px] rounded-[28px] border border-emerald-200 bg-white p-6 shadow-[0_30px_70px_rgba(15,23,42,0.18)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-950">
                    Временный пароль для пользователя
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Сохраните эти данные сейчас. Пароль показывается только один раз.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIssuedCredentials(null);
                    setCredentialsCopied(false);
                  }}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Закрыть
                </button>
              </div>

              <div className="mt-5 grid gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Логин</p>
                  <p className="mt-2 break-all text-lg font-semibold text-slate-950">
                    {issuedCredentials.login}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Временный пароль
                  </p>
                  <p className="mt-2 break-all text-lg font-semibold text-slate-950">
                    {issuedCredentials.temporaryPassword}
                  </p>
                </div>
                <p className="text-sm leading-6 text-slate-600">
                  При первом входе пользователь должен будет сразу сменить пароль на свой.
                </p>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <AdminButton type="button" onClick={() => void handleCopyIssuedCredentials()}>
                  {credentialsCopied ? "Скопировано" : "Скопировать логин и пароль"}
                </AdminButton>
                <AdminButton
                  type="button"
                  tone="secondary"
                  onClick={() => {
                    setIssuedCredentials(null);
                    setCredentialsCopied(false);
                  }}
                >
                  Понятно
                </AdminButton>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 bg-slate-950/26 backdrop-blur-[2px]">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="w-full max-w-[520px] rounded-[28px] border border-rose-200 bg-white p-6 shadow-[0_30px_70px_rgba(15,23,42,0.18)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-slate-950">
                    Удалить учётную запись?
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Вы действительно хотите удалить учётную запись{" "}
                    <span className="font-semibold text-slate-950">{deleteTarget.fullName}</span>
                    {deleteTarget.email ? <> ({deleteTarget.email})</> : null}
                    ? Это действие необратимо.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                  disabled={deletingUser}
                >
                  Закрыть
                </button>
              </div>

              <div className="mt-5 rounded-[24px] border border-rose-100 bg-rose-50 px-4 py-4 text-sm leading-6 text-rose-900">
                Учётная запись будет удалена из системы. Перед удалением убедитесь, что этот доступ больше не нужен.
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <AdminButton
                  type="button"
                  tone="danger"
                  onClick={() => void handleDeleteUser()}
                  disabled={deletingUser}
                >
                  {deletingUser ? "Удаляем..." : "Да, удалить"}
                </AdminButton>
                <AdminButton
                  type="button"
                  tone="secondary"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deletingUser}
                >
                  Отмена
                </AdminButton>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </AdminPage>
  );
}
