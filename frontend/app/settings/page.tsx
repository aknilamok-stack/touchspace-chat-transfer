"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "@/lib/api";
import {
  clearAuthSession,
  getHomePathForRole,
  isInternalRole,
  isSupplierRole,
  logoutServerSession,
  readAuthSession,
  writeAuthSession,
  type AuthSession,
} from "@/lib/auth";
import {
  enablePushNotifications,
  getCurrentPushEndpoint,
  getInternalProfileId,
  sendTestPush,
  unsubscribeCurrentPushSubscription,
} from "@/lib/push-notifications";
import { isDesktopShell, readDesktopRuntimeMeta } from "@/lib/runtime";

type NotificationSettingsResponse = {
  profile: {
    id: string;
    role: string;
    fullName: string;
    email?: string | null;
  };
  preferences: {
    notificationPushEnabled: boolean;
    notifyClientChats: boolean;
    notifySupplierChats: boolean;
    notifySupplierRequests: boolean;
    notifyAiHandoffs: boolean;
    notifyAdminAlerts: boolean;
  };
  counters: Record<string, number>;
  devices: Array<{
    id: string;
    endpoint: string;
    role: string;
    deviceLabel?: string | null;
    userAgent?: string | null;
    isActive: boolean;
    lastUsedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const roleLabels: Record<string, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  manager_supervisor: "Управленец менеджеров",
  supplier: "Поставщик",
  supplier_supervisor: "Управленец поставщика",
};

const preferenceLabels = [
  {
    key: "notificationPushEnabled",
    title: "Разрешить desktop push-уведомления",
    description: "Главный переключатель для системных уведомлений на всех подключённых устройствах.",
  },
  {
    key: "notifyClientChats",
    title: "Новые клиентские сообщения",
    description: "Уведомления, когда клиент пишет в диалог и от роли ожидается реакция.",
  },
  {
    key: "notifySupplierChats",
    title: "Сообщения по supplier-диалогам",
    description: "Уведомления по диалогам с поставщиками и связанным чатам.",
  },
  {
    key: "notifySupplierRequests",
    title: "Новые supplier requests",
    description: "Уведомления о новых запросах поставщику и новых задачах этого контура.",
  },
  {
    key: "notifyAiHandoffs",
    title: "Возвраты из AI-режима",
    description: "Уведомления, когда AI передаёт диалог обратно менеджеру.",
  },
  {
    key: "notifyAdminAlerts",
    title: "Системные и тестовые уведомления",
    description: "Технические и административные push-события, включая тестовый push.",
  },
] as const;

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

const buildCounters = (role: string, counters: Record<string, number>) => {
  if (role === "admin") {
    return [
      { label: "Регистрации на проверке", value: counters.pendingRegistrations ?? 0, tone: "bg-amber-50 text-amber-900 border-amber-200" },
      { label: "SLA с риском", value: counters.slaBreaches ?? 0, tone: "bg-rose-50 text-rose-900 border-rose-200" },
      { label: "AI handoff в работе", value: counters.aiHandoffs ?? 0, tone: "bg-sky-50 text-sky-900 border-sky-200" },
    ];
  }

  if (isSupplierRole(role)) {
    return [
      { label: "Непрочитанные диалоги", value: counters.unreadDialogs ?? 0, tone: "bg-sky-50 text-sky-900 border-sky-200" },
      { label: "Новые запросы", value: counters.newRequests ?? 0, tone: "bg-emerald-50 text-emerald-900 border-emerald-200" },
      { label: "Открытые диалоги", value: counters.openDialogs ?? 0, tone: "bg-slate-50 text-slate-900 border-slate-200" },
    ];
  }

  return [
    { label: "Непрочитанные диалоги", value: counters.unreadDialogs ?? 0, tone: "bg-sky-50 text-sky-900 border-sky-200" },
    { label: "AI-диалоги под наблюдением", value: counters.aiDialogs ?? 0, tone: "bg-violet-50 text-violet-900 border-violet-200" },
    { label: "Поставщики без ответа", value: counters.pendingSupplierRequests ?? 0, tone: "bg-amber-50 text-amber-900 border-amber-200" },
  ];
};

export default function NotificationSettingsPage() {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [isInstalled, setIsInstalled] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [currentEndpoint, setCurrentEndpoint] = useState("");
  const [data, setData] = useState<NotificationSettingsResponse | null>(null);
  const [desktopMode, setDesktopMode] = useState(false);
  const [desktopPlatform, setDesktopPlatform] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const profileId = getInternalProfileId(session);
  const homeHref = getHomePathForRole(session?.role);
  const useCompactProfileSettings = session?.role === "manager" || session?.role === "supplier";

  const counters = useMemo(
    () => buildCounters(session?.role ?? "manager", data?.counters ?? {}),
    [data?.counters, session?.role],
  );

  const loadSettings = async (currentSession: AuthSession) => {
    const currentProfileId = getInternalProfileId(currentSession);

    if (!currentProfileId || !currentSession.role) {
      throw new Error("Не удалось определить текущего пользователя.");
    }

    const response = await fetch(
      apiUrl(
        `/notifications/settings?profileId=${encodeURIComponent(currentProfileId)}&role=${encodeURIComponent(currentSession.role)}`,
      ),
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить настройки уведомлений.");
    }

    const payload = (await response.json()) as NotificationSettingsResponse;
    setData(payload);
  };

  useEffect(() => {
    const currentSession = readAuthSession();

    if (!currentSession || !isInternalRole(currentSession.role)) {
      router.replace("/login");
      return;
    }

    setSession(currentSession);
    setPermission(typeof Notification === "undefined" ? "default" : Notification.permission);
    const inDesktopShell = typeof window !== "undefined" && isDesktopShell();
    setDesktopMode(inDesktopShell);
    setIsInstalled(typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || inDesktopShell));

    readDesktopRuntimeMeta()
      .then((meta) => setDesktopPlatform(meta?.platform ?? ""))
      .catch(() => setDesktopPlatform(""));

    getCurrentPushEndpoint()
      .then(setCurrentEndpoint)
      .catch(() => setCurrentEndpoint(""));

    loadSettings(currentSession)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить настройки."))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setInstallPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    setFullName((data?.profile.fullName || session.fullName || "").trim());
    setEmail((data?.profile.email || session.email || "").trim());
  }, [data?.profile.email, data?.profile.fullName, session]);

  const handleInstall = async () => {
    if (desktopMode) {
      setInfo("TouchSpace уже открыт как отдельное desktop-приложение.");
      return;
    }

    if (!installPromptEvent) {
      setInfo("В этом браузере приложение можно установить через меню браузера.");
      return;
    }

    await installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    setInstallPromptEvent(null);
  };

  const handleEnableNotifications = async () => {
    if (!session) {
      return;
    }

    setActionLoading("enable");
    setError("");
    setInfo("");

    try {
      const result = await enablePushNotifications(session);
      setPermission(result.permission);

      if (result.enabled) {
        setCurrentEndpoint(result.endpoint ?? "");
        await loadSettings(session);
        setInfo("Устройство подключено к системным уведомлениям.");
      } else {
        setInfo(
          result.permission === "denied"
            ? "Уведомления запрещены в браузере. Разреши их в настройках сайта."
            : "Разрешение на уведомления не выдано.",
        );
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Не удалось включить уведомления.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSendTest = async () => {
    if (!session) {
      return;
    }

    setActionLoading("test");
    setError("");
    setInfo("");

    try {
      await sendTestPush(session);
      setInfo("Тестовый push отправлен.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Не удалось отправить тестовый push.");
    } finally {
      setActionLoading(null);
    }
  };

  const handlePreferenceToggle = async (
    key: keyof NotificationSettingsResponse["preferences"],
    value: boolean,
  ) => {
    if (!session || !data || !profileId) {
      return;
    }

    const nextPreferences = {
      ...data.preferences,
      [key]: value,
    };

    setData({
      ...data,
      preferences: nextPreferences,
    });
    setSaving(true);
    setError("");
    setInfo("");

    try {
      const response = await fetch(apiUrl("/notifications/preferences"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profileId,
          role: session.role,
          [key]: value,
        }),
      });

      if (!response.ok) {
        throw new Error("Не удалось сохранить настройки уведомлений.");
      }

      setInfo("Настройки сохранены.");
    } catch (actionError) {
      setData({
        ...data,
        preferences: data.preferences,
      });
      setError(actionError instanceof Error ? actionError.message : "Не удалось сохранить настройки.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivateDevice = async (deviceId: string, endpoint: string) => {
    if (!session || !profileId) {
      return;
    }

    setActionLoading(deviceId);
    setError("");
    setInfo("");

    try {
      await fetch(apiUrl(`/notifications/subscriptions/${deviceId}/deactivate`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profileId,
        }),
      });

      if (endpoint === currentEndpoint) {
        await unsubscribeCurrentPushSubscription();
        setCurrentEndpoint("");
        setPermission(typeof Notification === "undefined" ? "default" : Notification.permission);
      }

      await loadSettings(session);
      setInfo("Устройство отключено от push-уведомлений.");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Не удалось отключить устройство.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveBasicProfile = async () => {
    if (!session || !profileId) {
      return;
    }

    const normalizedFullName = fullName.trim();

    if (!normalizedFullName) {
      setError("Имя обязательно.");
      setInfo("");
      return;
    }

    setProfileSaving(true);
    setError("");
    setInfo("");

    try {
      const response = await fetch(apiUrl(`/profiles/${encodeURIComponent(profileId)}/basic`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: normalizedFullName,
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Не удалось сохранить имя.");
      }

      const payload = (await response.json()) as {
        id: string;
        fullName: string;
        email?: string | null;
        role: string;
      };

      const nextSession = {
        ...session,
        fullName: payload.fullName,
        email: payload.email ?? session.email,
        adminName: session.role === "admin" ? payload.fullName : session.adminName,
        managerName: session.role === "manager" ? payload.fullName : session.managerName,
        supplierName: isSupplierRole(session.role) ? payload.fullName : session.supplierName,
      };

      setData((current) =>
        current
          ? {
              ...current,
              profile: {
                ...current.profile,
                fullName: payload.fullName,
                email: payload.email ?? current.profile.email,
              },
            }
          : current,
      );
      setSession(nextSession);
      writeAuthSession(nextSession);
      setFullName(payload.fullName);
      setEmail(payload.email ?? session.email ?? "");
      setInfo("Имя обновлено.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сохранить имя.");
    } finally {
      setProfileSaving(false);
    }
  };

  const handleSavePassword = async () => {
    if (!session?.userId) {
      setError("Сессия пользователя не найдена.");
      setInfo("");
      return;
    }

    if (!currentPassword.trim()) {
      setError("Укажи текущий пароль.");
      setInfo("");
      return;
    }

    if (newPassword.trim().length < 8) {
      setError("Новый пароль должен быть не короче 8 символов.");
      setInfo("");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Новые пароли не совпадают.");
      setInfo("");
      return;
    }

    setPasswordSaving(true);
    setError("");
    setInfo("");

    try {
      const response = await fetch(apiUrl("/auth/change-password"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: session.userId,
          currentPassword,
          newPassword,
        }),
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "Не удалось сменить пароль.");
      }

      const nextSession = {
        ...session,
        passwordChangeRequired: false,
      };

      setSession(nextSession);
      writeAuthSession(nextSession);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setInfo("Пароль обновлён.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сменить пароль.");
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading || !session) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f5f8ff_0%,#eef3fb_40%,#f8fafc_100%)] px-4 py-6">
        <div className="mx-auto max-w-6xl rounded-[28px] bg-white/90 p-8 shadow-[0_20px_60px_rgba(148,163,184,0.16)]">
          <div className="h-8 w-64 rounded-full bg-slate-100" />
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="h-32 rounded-[24px] bg-slate-100" />
            <div className="h-32 rounded-[24px] bg-slate-100" />
            <div className="h-32 rounded-[24px] bg-slate-100" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f5f8ff_0%,#eef3fb_40%,#f8fafc_100%)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <section className="rounded-[28px] border border-slate-200/80 bg-white/92 px-6 py-5 shadow-[0_20px_60px_rgba(148,163,184,0.16)] backdrop-blur">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">
                TouchSpace Workspace
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Настройки</h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {useCompactProfileSettings
                  ? "Здесь можно обновить имя и пароль учётной записи. Email показывается только для справки."
                  : (
                    <>
                      Управление системными push-уведомлениями, устройствами и рабочими счётчиками для роли{" "}
                      <span className="font-semibold text-slate-700">{roleLabels[session.role] ?? session.role}</span>.
                    </>
                  )}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href={homeHref}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Вернуться в рабочую зону
              </Link>
              <button
                type="button"
                onClick={() => {
                  void logoutServerSession(session).finally(() => {
                    clearAuthSession();
                    router.replace("/login");
                  });
                }}
                className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Выйти
              </button>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-[24px] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {info ? (
          <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
            {info}
          </div>
        ) : null}

        {useCompactProfileSettings ? (
          <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <article className="rounded-[28px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_20px_60px_rgba(148,163,184,0.16)]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Профиль</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight">Основные данные</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Имя можно обновить в любой момент. Email закреплён за учётной записью и недоступен для редактирования.
                  </p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700">
                  {roleLabels[session.role] ?? session.role}
                </span>
              </div>

              <div className="mt-6 grid gap-4">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">Имя</span>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    placeholder="Введите имя"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">Email</span>
                  <input
                    type="email"
                    value={email}
                    readOnly
                    className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 outline-none"
                    placeholder="Email не указан"
                  />
                </label>
              </div>

              <div className="mt-6 flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
                <p className="text-sm text-slate-500">Из настроек профиля здесь доступно только имя.</p>
                <button
                  type="button"
                  onClick={() => void handleSaveBasicProfile()}
                  disabled={profileSaving}
                  className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {profileSaving ? "Сохраняем..." : "Сохранить имя"}
                </button>
              </div>
            </article>

            <article className="rounded-[28px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_20px_60px_rgba(148,163,184,0.16)]">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Пароль</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">Смена пароля</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Других настроек для менеджера и поставщика здесь больше нет. При необходимости можно только обновить пароль.
                </p>
              </div>

              <div className="mt-6 grid gap-4">
                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">Текущий пароль</span>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    placeholder="Введите текущий пароль"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">Новый пароль</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    placeholder="Минимум 8 символов"
                  />
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-medium text-slate-700">Повторите новый пароль</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="rounded-[18px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                    placeholder="Повторите новый пароль"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => void handleSavePassword()}
                disabled={passwordSaving}
                className="mt-6 w-full rounded-full bg-sky-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
              >
                {passwordSaving ? "Сохраняем..." : "Обновить пароль"}
              </button>
            </article>
          </section>
        ) : null}

        {useCompactProfileSettings ? null : (
          <>
        <section className="grid gap-4 md:grid-cols-3">
          <article className="rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_20px_60px_rgba(148,163,184,0.16)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Режим приложения</p>
            <p className="mt-3 text-2xl font-semibold text-slate-950">
              {desktopMode ? "Desktop app" : isInstalled ? "Установлено" : "В браузере"}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {desktopMode
                ? "TouchSpace уже открыт в отдельном desktop-окне и использует тот же рабочий backend."
                : isInstalled
                  ? "TouchSpace уже работает как отдельное app-window."
                  : "Установи приложение, чтобы оно открывалось как отдельное окно и жило ближе к desktop-опыту."}
            </p>
            <button
              type="button"
              onClick={() => void handleInstall()}
              disabled={desktopMode}
              className="mt-4 rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              {desktopMode ? "Открыто как desktop app" : isInstalled ? "Приложение установлено" : "Установить приложение"}
            </button>
            {desktopMode ? (
              <p className="mt-3 text-xs text-slate-500">
                Desktop shell{desktopPlatform ? `: ${desktopPlatform}` : ""}.
              </p>
            ) : null}
          </article>

          <article className="rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_20px_60px_rgba(148,163,184,0.16)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Desktop notifications</p>
            <p className="mt-3 text-2xl font-semibold text-slate-950">
              {permission === "granted" ? "Включены" : permission === "denied" ? "Запрещены" : "Не подключены"}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {permission === "granted"
                ? "Системные уведомления будут приходить даже когда вкладка не активна."
                : permission === "denied"
                  ? "Разрешение заблокировано браузером. Его можно вернуть в настройках сайта."
                  : "После явного действия можно подключить системные уведомления для этого устройства."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleEnableNotifications()}
                disabled={actionLoading === "enable"}
                className="rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-60"
              >
                {actionLoading === "enable" ? "Подключаем..." : "Включить уведомления"}
              </button>
              <button
                type="button"
                onClick={() => void handleSendTest()}
                disabled={actionLoading === "test" || permission !== "granted"}
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {actionLoading === "test" ? "Отправляем..." : "Тестовый push"}
              </button>
            </div>
          </article>

          <article className="rounded-[28px] border border-slate-200/80 bg-white/92 p-5 shadow-[0_20px_60px_rgba(148,163,184,0.16)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Профиль</p>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{data?.profile.fullName ?? "Пользователь"}</p>
            <p className="mt-2 text-sm text-slate-500">{data?.profile.email || "Email пока не указан"}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-600">
              <span className="rounded-full bg-slate-100 px-3 py-2">{roleLabels[session.role] ?? session.role}</span>
              <span className="rounded-full bg-emerald-100 px-3 py-2 text-emerald-800">
                Устройств: {data?.devices.length ?? 0}
              </span>
            </div>
          </article>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {counters.map((counter) => (
            <article
              key={counter.label}
              className={`rounded-[28px] border p-5 shadow-[0_20px_60px_rgba(148,163,184,0.16)] ${counter.tone}`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] opacity-70">
                Live counters
              </p>
              <p className="mt-3 text-4xl font-semibold">{counter.value}</p>
              <p className="mt-2 text-sm leading-6 opacity-80">{counter.label}</p>
            </article>
          ))}
        </section>

        <section className="rounded-[28px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_20px_60px_rgba(148,163,184,0.16)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Preferences</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Типы уведомлений</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Эти переключатели определяют, какие push-события сервер будет отправлять именно тебе.
              </p>
            </div>
            <p className="text-sm text-slate-400">{saving ? "Сохраняем изменения..." : "Изменения применяются сразу"}</p>
          </div>

          <div className="mt-6 grid gap-3">
            {data
              ? preferenceLabels.map((item) => {
                  const checked = data.preferences[item.key];

                  return (
                    <label
                      key={item.key}
                      className="flex items-start justify-between gap-4 rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-4"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-500">{item.description}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={checked}
                        onClick={() => void handlePreferenceToggle(item.key, !checked)}
                        className={`relative mt-1 inline-flex h-7 w-12 shrink-0 rounded-full transition ${
                          checked ? "bg-sky-600" : "bg-slate-300"
                        }`}
                      >
                        <span
                          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${
                            checked ? "left-6" : "left-1"
                          }`}
                        />
                      </button>
                    </label>
                  );
                })
              : null}
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_20px_60px_rgba(148,163,184,0.16)]">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Devices</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Подключённые устройства</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Здесь видно, с каких устройств разрешены push-уведомления. Любое устройство можно отключить отдельно.
            </p>
          </div>

          <div className="mt-6 grid gap-3">
            {data?.devices.length ? (
              data.devices.map((device) => {
                const isCurrentDevice = currentEndpoint && device.endpoint === currentEndpoint;

                return (
                  <article
                    key={device.id}
                    className="rounded-[22px] border border-slate-200/80 bg-slate-50/80 px-4 py-4"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-600">
                          <span className="rounded-full bg-white px-3 py-1.5">
                            {device.deviceLabel || "Неизвестное устройство"}
                          </span>
                          <span
                            className={`rounded-full px-3 py-1.5 ${
                              device.isActive
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-slate-200 text-slate-600"
                            }`}
                          >
                            {device.isActive ? "Активно" : "Отключено"}
                          </span>
                          {isCurrentDevice ? (
                            <span className="rounded-full bg-sky-100 px-3 py-1.5 text-sky-800">
                              Текущее устройство
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-3 text-sm font-medium text-slate-900">
                          Последняя активность: {formatDateTime(device.lastUsedAt)}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          Подключено: {formatDateTime(device.createdAt)}
                        </p>
                        <p className="mt-3 break-all text-xs leading-5 text-slate-400">
                          {device.endpoint}
                        </p>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          disabled={!device.isActive || actionLoading === device.id}
                          onClick={() => void handleDeactivateDevice(device.id, device.endpoint)}
                          className="rounded-full border border-rose-200 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                        >
                          {actionLoading === device.id ? "Отключаем..." : "Отключить"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="rounded-[22px] border border-dashed border-slate-200 bg-slate-50/80 px-5 py-8 text-sm text-slate-500">
                Пока нет подключённых устройств для системных уведомлений.
              </div>
            )}
          </div>
        </section>
          </>
        )}
      </div>
    </div>
  );
}
