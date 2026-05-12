"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "@/lib/api";
import { readAuthSession, type AuthSession } from "@/lib/auth";

type SupervisorScope = "manager_supervisor" | "supplier_supervisor";
type OperatorStatus = "online" | "break" | "offline";

type OperatorItem = {
  id: string;
  fullName: string;
  authLogin?: string | null;
  email?: string | null;
  role: string;
  supplierId?: string | null;
  status: OperatorStatus;
  isActive?: boolean;
  lastSeenAt?: string | null;
  lastLoginAt?: string | null;
  passwordChangeRequired?: boolean;
  chatAccessEnabled: boolean;
};

type OperatorsResponse = {
  items?: OperatorItem[];
};

type AnalyticsPreset = "day" | "week" | "month" | "custom";

type SupervisorAnalytics = {
  summary: {
    totalRequests: number;
    markedRequests: number;
    unmarkedRequests: number;
    avgResponseMs: number | null;
    onTimeRate: number;
    rating: {
      label: string;
      tone: "good" | "warning" | "critical";
    };
  };
  breakdown: {
    byOperator: Array<{
      id: string;
      fullName: string;
      totalRequests: number;
      markedRequests: number;
      avgResponseMs: number | null;
      onTimeRate: number;
    }>;
  };
  insights: {
    activeOperators: number;
    topOperator: string | null;
    escalatedToSupplier?: number;
    unresolvedDialogs?: number;
    unansweredRequests?: number;
    takenInWork?: number;
  };
};

type ResetPasswordResponse = {
  credentials?: {
    login: string;
    temporaryPassword: string;
  };
};

const emptyCreateOperatorForm = {
  fullName: "",
  email: "",
  password: "",
  confirmPassword: "",
};

const operatorStatusLabel: Record<OperatorStatus, string> = {
  online: "В сети",
  break: "На перерыве",
  offline: "Не в сети",
};

const operatorStatusTone: Record<OperatorStatus, string> = {
  online: "bg-[#34C759]",
  break: "bg-[#FFB340]",
  offline: "bg-[#C7C7CC]",
};

const formatDateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Нет данных";

const formatDuration = (value?: number | null) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Нет данных";
  }

  const totalMinutes = Math.max(Math.round(value / 60000), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) {
    return `${minutes} мин`;
  }

  return `${hours} ч ${minutes} мин`;
};

const analyticsPresetLabels: Record<AnalyticsPreset, string> = {
  day: "День",
  week: "Неделя",
  month: "Месяц",
  custom: "Период",
};

const analyticsToneClasses: Record<
  "good" | "warning" | "critical",
  { ring: string; text: string; bg: string }
> = {
  good: {
    ring: "#34C759",
    text: "text-[#1B7A3C]",
    bg: "bg-[#F3FFF6]",
  },
  warning: {
    ring: "#FFB340",
    text: "text-[#A06300]",
    bg: "bg-[#FFF8EB]",
  },
  critical: {
    ring: "#FF6B6B",
    text: "text-[#C43D3D]",
    bg: "bg-[#FFF3F3]",
  },
};

export function OperatorsSettingsPage({
  scope,
  title,
  subtitle,
  backHref,
}: {
  scope: SupervisorScope;
  title: string;
  subtitle: string;
  backHref: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [operators, setOperators] = useState<OperatorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"operators" | "analytics">("operators");
  const [savingOperatorId, setSavingOperatorId] = useState("");
  const [togglingOperatorId, setTogglingOperatorId] = useState("");
  const [resettingOperatorId, setResettingOperatorId] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [credentialsMessage, setCredentialsMessage] = useState("");
  const [creatingOperator, setCreatingOperator] = useState(false);
  const [activatingOperatorId, setActivatingOperatorId] = useState("");
  const [draftAuthLogins, setDraftAuthLogins] = useState<Record<string, string>>({});
  const [draftEmails, setDraftEmails] = useState<Record<string, string>>({});
  const [createOperatorForm, setCreateOperatorForm] = useState(emptyCreateOperatorForm);
  const [analytics, setAnalytics] = useState<SupervisorAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsPreset, setAnalyticsPreset] = useState<AnalyticsPreset>("day");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const pageAccent = scope === "manager_supervisor" ? "text-[#0A84FF]" : "text-[#0F9F6E]";
  const buttonAccent =
    scope === "manager_supervisor"
      ? "bg-[#0A84FF] hover:bg-[#0077F2]"
      : "bg-[#0F9F6E] hover:bg-[#0C8A5F]";

  const loadOperators = async (currentSession: AuthSession) => {
    if (!currentSession.userId) {
      throw new Error("Не удалось определить управленца.");
    }

    const response = await fetch(
      apiUrl(`/supervisors/operators?supervisorId=${encodeURIComponent(currentSession.userId)}`)
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить операторов");
    }

    const payload = (await response.json()) as OperatorsResponse;
    const nextItems = Array.isArray(payload.items) ? payload.items : [];

    setOperators(nextItems);
    setDraftAuthLogins(
      Object.fromEntries(nextItems.map((item) => [item.id, item.authLogin ?? ""]))
    );
    setDraftEmails(Object.fromEntries(nextItems.map((item) => [item.id, item.email ?? ""])));
  };

  const loadAnalytics = async (currentSession: AuthSession, options?: {
    preset?: AnalyticsPreset;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    if (!currentSession.userId) {
      throw new Error("Не удалось определить управленца.");
    }

    const preset = options?.preset ?? analyticsPreset;
    const params = new URLSearchParams({
      supervisorId: currentSession.userId,
      preset,
    });

    if (preset === "custom") {
      if (options?.dateFrom) {
        params.set("dateFrom", options.dateFrom);
      }

      if (options?.dateTo) {
        params.set("dateTo", options.dateTo);
      }
    }

    const response = await fetch(apiUrl(`/supervisors/analytics?${params.toString()}`));

    if (!response.ok) {
      throw new Error("Не удалось загрузить аналитику");
    }

    setAnalytics((await response.json()) as SupervisorAnalytics);
  };

  useEffect(() => {
    const currentSession = readAuthSession();

    if (!currentSession || currentSession.role !== scope) {
      router.replace("/login");
      return;
    }

    setSession(currentSession);
    Promise.all([loadOperators(currentSession), loadAnalytics(currentSession, { preset: "day" })])
      .catch((loadError) =>
        setError(
          loadError instanceof Error ? loadError.message : "Не удалось загрузить настройки"
        )
      )
      .finally(() => setLoading(false));
  }, [router, scope]);

  const operatorsCountLabel = useMemo(() => `${operators.length} операторов`, [operators.length]);
  const analyticsTone = analytics
    ? analyticsToneClasses[analytics.summary.rating.tone]
    : analyticsToneClasses.good;
  const donutAngle = analytics ? Math.round((analytics.summary.onTimeRate / 100) * 360) : 360;

  const handleToggleChatAccess = async (operatorId: string, enabled: boolean) => {
    if (!session?.userId) {
      return;
    }

    setTogglingOperatorId(operatorId);
    setError("");
    setInfoMessage("");

    try {
      const response = await fetch(apiUrl(`/supervisors/operators/${operatorId}/chat-access`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supervisorId: session.userId,
          enabled,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось обновить доступ к чатам");
      }

      setOperators((currentOperators) =>
        currentOperators.map((item) =>
          item.id === operatorId ? { ...item, chatAccessEnabled: enabled } : item
        )
      );
      setInfoMessage(
        enabled
          ? "Оператор снова может отвечать и получать уведомления."
          : "Оператор переведён в режим чтения без уведомлений."
      );
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "Не удалось обновить доступ к чатам"
      );
    } finally {
      setTogglingOperatorId("");
    }
  };

  const handleSaveAccount = async (operatorId: string) => {
    if (!session?.userId) {
      return;
    }

    setSavingOperatorId(operatorId);
    setError("");
    setInfoMessage("");
    setCredentialsMessage("");

    try {
      const response = await fetch(apiUrl(`/supervisors/operators/${operatorId}/account`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supervisorId: session.userId,
          authLogin: draftAuthLogins[operatorId]?.trim(),
          email: draftEmails[operatorId]?.trim() || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { operator?: Pick<OperatorItem, "id" | "authLogin" | "email" | "fullName">; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
            "Не удалось обновить логин и email"
        );
      }

      setOperators((currentOperators) =>
        currentOperators.map((item) =>
          item.id === operatorId
            ? {
                ...item,
                authLogin: payload?.operator?.authLogin ?? item.authLogin,
                email: payload?.operator?.email ?? item.email,
              }
            : item
        )
      );
      setInfoMessage("Данные оператора обновлены.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Не удалось обновить логин и email"
      );
    } finally {
      setSavingOperatorId("");
    }
  };

  const handleResetPassword = async (operatorId: string) => {
    if (!session?.userId) {
      return;
    }

    setResettingOperatorId(operatorId);
    setError("");
    setInfoMessage("");
    setCredentialsMessage("");

    try {
      const response = await fetch(
        apiUrl(`/supervisors/operators/${operatorId}/reissue-password`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            supervisorId: session.userId,
          }),
        }
      );

      const payload = (await response.json().catch(() => null)) as
        | (ResetPasswordResponse & { message?: string })
        | null;

      if (!response.ok || !payload?.credentials) {
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
            "Не удалось сбросить пароль"
        );
      }

      setCredentialsMessage(
        `Новый временный пароль: ${payload.credentials.login} / ${payload.credentials.temporaryPassword}`
      );
    } catch (resetError) {
      setError(
        resetError instanceof Error ? resetError.message : "Не удалось сбросить пароль"
      );
    } finally {
      setResettingOperatorId("");
    }
  };

  const handleCreateOperator = async () => {
    if (!session?.userId || scope !== "supplier_supervisor") {
      return;
    }

    setCreatingOperator(true);
    setError("");
    setInfoMessage("");
    setCredentialsMessage("");

    if (createOperatorForm.password !== createOperatorForm.confirmPassword) {
      setError("Пароль и подтверждение не совпадают");
      setCreatingOperator(false);
      return;
    }

    try {
      const response = await fetch(apiUrl("/supervisors/operators"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supervisorId: session.userId,
          fullName: createOperatorForm.fullName.trim(),
          email: createOperatorForm.email.trim(),
          password: createOperatorForm.password,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | (ResetPasswordResponse & { message?: string })
        | null;

      if (!response.ok || !payload?.credentials) {
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
            "Не удалось создать оператора"
        );
      }

      setCreateOperatorForm(emptyCreateOperatorForm);
      setCredentialsMessage(
        `Пользователь создан. Логин: ${payload.credentials.login} / пароль: ${payload.credentials.temporaryPassword}. При первом входе пароль нужно сменить.`
      );
      setInfoMessage("Оператор поставщика добавлен.");
      await loadOperators(session);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось создать оператора"
      );
    } finally {
      setCreatingOperator(false);
    }
  };

  const handleToggleActivation = async (operator: OperatorItem) => {
    if (!session?.userId || scope !== "supplier_supervisor") {
      return;
    }

    setActivatingOperatorId(operator.id);
    setError("");
    setInfoMessage("");
    setCredentialsMessage("");

    try {
      const response = await fetch(
        apiUrl(`/supervisors/operators/${operator.id}/activation`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            supervisorId: session.userId,
            enabled: !operator.isActive,
          }),
        }
      );

      const payload = (await response.json().catch(() => null)) as
        | { operator?: { id: string; isActive: boolean }; message?: string }
        | null;

      if (!response.ok) {
        throw new Error(
          (typeof payload?.message === "string" && payload.message) ||
            "Не удалось изменить активность пользователя"
        );
      }

      setOperators((current) =>
        current.map((item) =>
          item.id === operator.id
            ? {
                ...item,
                isActive: payload?.operator?.isActive ?? !operator.isActive,
              }
            : item
        )
      );
      setInfoMessage(
        operator.isActive
          ? "Пользователь деактивирован."
          : "Пользователь снова активен."
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Не удалось изменить активность пользователя"
      );
    } finally {
      setActivatingOperatorId("");
    }
  };

  const handleApplyAnalyticsFilter = async (nextPreset = analyticsPreset) => {
    if (!session) {
      return;
    }

    setAnalyticsLoading(true);
    setAnalyticsError("");

    try {
      await loadAnalytics(session, {
        preset: nextPreset,
        dateFrom,
        dateTo,
      });
    } catch (loadError) {
      setAnalyticsError(
        loadError instanceof Error ? loadError.message : "Не удалось загрузить аналитику"
      );
    } finally {
      setAnalyticsLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F4F6F8] px-6 py-8 text-[#6C6C70]">
        Загружаем настройки...
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F4F6F8] px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <button
          type="button"
          onClick={() => router.push(backHref)}
          className="inline-flex items-center gap-2 rounded-full border border-[#D9DFEA] bg-white px-4 py-2 text-sm font-medium text-[#1E1E1E] transition hover:bg-[#F9FBFF]"
        >
          <span aria-hidden="true">←</span>
          <span>Назад</span>
        </button>

        <div className="mt-5 rounded-[28px] border border-[#E3E8F2] bg-white p-6 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${pageAccent}`}>
            Настройки управленца
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-[30px] font-semibold text-[#1E1E1E]">{title}</h1>
              <p className="mt-2 text-sm text-[#6C6C70]">{subtitle}</p>
            </div>
            <div className="rounded-full bg-[#F5F7FB] px-4 py-2 text-sm font-medium text-[#4E5562]">
              {operatorsCountLabel}
            </div>
          </div>

          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("operators")}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === "operators"
                  ? `${buttonAccent} text-white`
                  : "bg-[#F2F4F8] text-[#5F6673] hover:bg-[#E9EEF7]"
              }`}
            >
              Операторы
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("analytics");
                if (!analytics) {
                  void handleApplyAnalyticsFilter();
                }
              }}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeTab === "analytics"
                  ? `${buttonAccent} text-white`
                  : "bg-[#F2F4F8] text-[#5F6673] hover:bg-[#E9EEF7]"
              }`}
            >
              Аналитика
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-[18px] border border-[#F3D0D0] bg-[#FFF4F4] px-4 py-3 text-sm text-[#C43D3D]">
            {error}
          </div>
        ) : null}

        {infoMessage ? (
          <div className="mt-4 rounded-[18px] border border-[#D6E9DB] bg-[#F3FFF6] px-4 py-3 text-sm text-[#1B7A3C]">
            {infoMessage}
          </div>
        ) : null}

        {credentialsMessage ? (
          <div className="mt-4 rounded-[18px] border border-[#DCE7FF] bg-[#F5F9FF] px-4 py-3 text-sm text-[#1E1E1E]">
            {credentialsMessage}
          </div>
        ) : null}

        {activeTab === "operators" ? (
        <section className="mt-6 space-y-4">
          {scope === "supplier_supervisor" ? (
            <article className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#1E1E1E]">
                    Подключить оператора поставщика
                  </h2>
                  <p className="mt-1 text-sm text-[#6C6C70]">
                    Можно создавать только операторов своей компании. При первом входе пользователь
                    сразу попадёт на смену пароля.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                    Имя поставщика
                  </span>
                  <input
                    value={createOperatorForm.fullName}
                    onChange={(event) =>
                      setCreateOperatorForm((current) => ({
                        ...current,
                        fullName: event.target.value,
                      }))
                    }
                    className="w-full rounded-[16px] border border-[#D6DCE7] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none"
                    placeholder="Анна"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                    Email
                  </span>
                  <input
                    type="email"
                    value={createOperatorForm.email}
                    onChange={(event) =>
                      setCreateOperatorForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    className="w-full rounded-[16px] border border-[#D6DCE7] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none"
                    placeholder="anna@company.ru"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                    Пароль
                  </span>
                  <input
                    type="text"
                    value={createOperatorForm.password}
                    onChange={(event) =>
                      setCreateOperatorForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    className="w-full rounded-[16px] border border-[#D6DCE7] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none"
                    placeholder="Минимум 8 символов"
                  />
                </label>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                    Повторите пароль
                  </span>
                  <input
                    type="text"
                    value={createOperatorForm.confirmPassword}
                    onChange={(event) =>
                      setCreateOperatorForm((current) => ({
                        ...current,
                        confirmPassword: event.target.value,
                      }))
                    }
                    className="w-full rounded-[16px] border border-[#D6DCE7] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none"
                    placeholder="Повторите пароль"
                  />
                </label>

                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={creatingOperator}
                    onClick={() => void handleCreateOperator()}
                    className={`rounded-full px-5 py-3 text-sm font-semibold text-white transition disabled:opacity-60 ${buttonAccent}`}
                  >
                    {creatingOperator ? "Создаём..." : "Добавить пользователя"}
                  </button>
                </div>
              </div>
            </article>
          ) : null}

          {operators.map((operator) => {
            const showLastSeen = operator.status !== "online";

            return (
              <article
                key={operator.id}
                className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`h-3 w-3 rounded-full ${operatorStatusTone[operator.status]}`}
                      />
                      <h2 className="text-lg font-semibold text-[#1E1E1E]">
                        {operator.fullName}
                      </h2>
                    </div>
                    <p className="mt-2 text-sm text-[#6C6C70]">
                      Статус: {operatorStatusLabel[operator.status]}
                    </p>
                    <p className="mt-1 text-xs text-[#8E8E93]">
                      Аккаунт: {operator.isActive === false ? "деактивирован" : "активен"}
                    </p>
                    {showLastSeen ? (
                      <p className="mt-1 text-xs text-[#8E8E93]">
                        Последний вход: {formatDateTime(operator.lastLoginAt || operator.lastSeenAt)}
                      </p>
                    ) : null}
                  </div>

                  <div className="min-w-[220px] rounded-[18px] border border-[#E8EDF4] bg-[#FBFCFE] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8E8E93]">
                          Доступ к чатам
                        </p>
                        <p className="mt-1 text-sm text-[#5F6673]">
                          {operator.chatAccessEnabled
                            ? "Может писать и получать уведомления"
                            : "Только чтение без уведомлений"}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={togglingOperatorId === operator.id}
                        onClick={() =>
                          void handleToggleChatAccess(
                            operator.id,
                            !operator.chatAccessEnabled
                          )
                        }
                        className={`relative inline-flex h-8 w-[62px] items-center rounded-full px-1 transition ${
                          operator.chatAccessEnabled ? "bg-[#34C759]" : "bg-[#D1D1D6]"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full bg-white text-[14px] shadow-[0_4px_10px_rgba(15,23,42,0.16)] transition ${
                            operator.chatAccessEnabled
                              ? "translate-x-[30px] text-[#F5C542]"
                              : "translate-x-0 text-[#9A9AA1]"
                          }`}
                        >
                          ⚡
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                      Логин
                    </span>
                    <input
                      value={draftAuthLogins[operator.id] ?? ""}
                      onChange={(event) =>
                        setDraftAuthLogins((current) => ({
                          ...current,
                          [operator.id]: event.target.value,
                        }))
                      }
                      className="w-full rounded-[16px] border border-[#D6DCE7] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none"
                      placeholder="login@example.com"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                      Email
                    </span>
                    <input
                      value={draftEmails[operator.id] ?? ""}
                      onChange={(event) =>
                        setDraftEmails((current) => ({
                          ...current,
                          [operator.id]: event.target.value,
                        }))
                      }
                      className="w-full rounded-[16px] border border-[#D6DCE7] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none"
                      placeholder="email@example.com"
                    />
                  </label>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={savingOperatorId === operator.id}
                    onClick={() => void handleSaveAccount(operator.id)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition disabled:opacity-60 ${buttonAccent}`}
                  >
                    {savingOperatorId === operator.id ? "Сохраняем..." : "Сохранить логин и email"}
                  </button>

                  <button
                    type="button"
                    disabled={resettingOperatorId === operator.id}
                    onClick={() => void handleResetPassword(operator.id)}
                    className="rounded-full border border-[#D6DCE7] bg-white px-4 py-2 text-sm font-semibold text-[#1E1E1E] transition hover:bg-[#F7F9FC] disabled:opacity-60"
                  >
                    {resettingOperatorId === operator.id ? "Сбрасываем..." : "Сбросить пароль"}
                  </button>
                  {scope === "supplier_supervisor" ? (
                    <button
                      type="button"
                      disabled={activatingOperatorId === operator.id}
                      onClick={() => void handleToggleActivation(operator)}
                      className="rounded-full border border-[#D6DCE7] bg-white px-4 py-2 text-sm font-semibold text-[#1E1E1E] transition hover:bg-[#F7F9FC] disabled:opacity-60"
                    >
                      {activatingOperatorId === operator.id
                        ? "Сохраняем..."
                        : operator.isActive === false
                          ? "Активировать"
                          : "Деактивировать"}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}

          {operators.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-[#D6DCE7] bg-white px-5 py-8 text-center text-sm text-[#8E8E93]">
              Операторы пока не найдены.
            </div>
          ) : null}
        </section>
        ) : (
        <section className="mt-6 space-y-6">
          <div className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-end gap-3">
              {(Object.keys(analyticsPresetLabels) as AnalyticsPreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setAnalyticsPreset(preset);
                    if (preset !== "custom") {
                      void handleApplyAnalyticsFilter(preset);
                    }
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    analyticsPreset === preset
                      ? `${buttonAccent} text-white`
                      : "bg-[#F2F4F8] text-[#5F6673] hover:bg-[#E9EEF7]"
                  }`}
                >
                  {analyticsPresetLabels[preset]}
                </button>
              ))}
            </div>

            {analyticsPreset === "custom" ? (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                    Дата от
                  </span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="rounded-[16px] border border-[#D6DCE7] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-[#8E8E93]">
                    Дата до
                  </span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="rounded-[16px] border border-[#D6DCE7] bg-white px-4 py-3 text-sm text-[#1E1E1E] outline-none"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleApplyAnalyticsFilter("custom")}
                  className={`rounded-full px-4 py-3 text-sm font-semibold text-white transition ${buttonAccent}`}
                >
                  Применить
                </button>
              </div>
            ) : null}
          </div>

          {analyticsError ? (
            <div className="rounded-[18px] border border-[#F3D0D0] bg-[#FFF4F4] px-4 py-3 text-sm text-[#C43D3D]">
              {analyticsError}
            </div>
          ) : null}

          {analyticsLoading && !analytics ? (
            <div className="rounded-[24px] border border-[#E3E8F2] bg-white px-5 py-8 text-sm text-[#8E8E93]">
              Загружаем аналитику...
            </div>
          ) : null}

          {analytics ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                    Всего запросов
                  </p>
                  <p className="mt-3 text-[32px] font-semibold text-[#1E1E1E]">
                    {analytics.summary.totalRequests}
                  </p>
                </div>

                <div className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                    Отмеченные
                  </p>
                  <p className="mt-3 text-[32px] font-semibold text-[#1E1E1E]">
                    {analytics.summary.markedRequests}
                  </p>
                  <p className="mt-2 text-sm text-[#6C6C70]">
                    Не отмеченные: {analytics.summary.unmarkedRequests}
                  </p>
                </div>

                <div className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                    Среднее время ответа
                  </p>
                  <p className="mt-3 text-[32px] font-semibold text-[#1E1E1E]">
                    {formatDuration(analytics.summary.avgResponseMs)}
                  </p>
                </div>

                <div className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                    Лучший оператор
                  </p>
                  <p className="mt-3 text-lg font-semibold text-[#1E1E1E]">
                    {analytics.insights.topOperator || "Нет данных"}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
                <div className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                    Рейтинг SLA
                  </p>
                  <div className="mt-5 flex flex-col items-center">
                    <div
                      className="relative flex h-[180px] w-[180px] items-center justify-center rounded-full"
                      style={{
                        background: `conic-gradient(${analyticsTone.ring} 0deg ${donutAngle}deg, #E9EDF5 ${donutAngle}deg 360deg)`,
                      }}
                    >
                      <div className="flex h-[124px] w-[124px] flex-col items-center justify-center rounded-full bg-white">
                        <span className="text-[34px] font-semibold text-[#1E1E1E]">
                          {analytics.summary.onTimeRate}%
                        </span>
                        <span className="mt-1 text-xs text-[#8E8E93]">вовремя</span>
                      </div>
                    </div>
                    <div className={`mt-5 rounded-[18px] px-4 py-3 text-center ${analyticsTone.bg}`}>
                      <p className={`text-sm font-semibold ${analyticsTone.text}`}>
                        {analytics.summary.rating.label}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                      Активные операторы
                    </p>
                    <p className="mt-3 text-[32px] font-semibold text-[#1E1E1E]">
                      {analytics.insights.activeOperators}
                    </p>
                  </div>

                  <div className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)]">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                      Доп. метрика
                    </p>
                    <p className="mt-3 text-lg font-semibold text-[#1E1E1E]">
                      {scope === "manager_supervisor"
                        ? `Эскалаций поставщику: ${analytics.insights.escalatedToSupplier ?? 0}`
                        : `Взято в работу: ${analytics.insights.takenInWork ?? 0}`}
                    </p>
                    <p className="mt-2 text-sm text-[#6C6C70]">
                      {scope === "manager_supervisor"
                        ? `Не решённых диалогов: ${analytics.insights.unresolvedDialogs ?? 0}`
                        : `Без ответа: ${analytics.insights.unansweredRequests ?? 0}`}
                    </p>
                  </div>

                  <div className="rounded-[24px] border border-[#E3E8F2] bg-white p-5 shadow-[0_14px_32px_rgba(15,23,42,0.05)] md:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#8E8E93]">
                        По операторам
                      </p>
                      <p className="text-xs text-[#8E8E93]">
                        Кол-во запросов и среднее время ответа
                      </p>
                    </div>

                    <div className="mt-4 space-y-3">
                      {analytics.breakdown.byOperator.map((item) => {
                        const progressWidth =
                          analytics.summary.totalRequests > 0
                            ? `${Math.max(
                                8,
                                Math.round((item.totalRequests / analytics.summary.totalRequests) * 100)
                              )}%`
                            : "8%";

                        return (
                          <div
                            key={item.id}
                            className="rounded-[18px] border border-[#EEF2F7] bg-[#FBFCFE] px-4 py-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-[#1E1E1E]">
                                  {item.fullName}
                                </p>
                                <p className="mt-1 text-xs text-[#6C6C70]">
                                  Отмечено: {item.markedRequests} из {item.totalRequests}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-[#1E1E1E]">
                                  {formatDuration(item.avgResponseMs)}
                                </p>
                                <p className="mt-1 text-xs text-[#6C6C70]">
                                  SLA вовремя: {item.onTimeRate}%
                                </p>
                              </div>
                            </div>
                            <div className="mt-3 h-2 rounded-full bg-[#E9EDF5]">
                              <div
                                className={`h-2 rounded-full ${scope === "manager_supervisor" ? "bg-[#0A84FF]" : "bg-[#0F9F6E]"}`}
                                style={{ width: progressWidth }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </section>
        )}
      </div>
    </main>
  );
}
