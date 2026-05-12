"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearAuthSession,
  logoutServerSession,
  readAuthSession,
  type AuthSession,
} from "@/lib/auth";

const navigation = [
  { href: "/admin", label: "Главная" },
  { href: "/admin/users", label: "Пользователи и доступы" },
  { href: "/admin/dialogs", label: "Диалоги" },
  { href: "/admin/analytics", label: "Общая аналитика" },
  { href: "/admin/analytics/insights", label: "Инсайты" },
  { href: "/admin/analytics/managers", label: "Менеджеры" },
  { href: "/admin/analytics/suppliers", label: "Поставщики" },
  { href: "/admin/sla", label: "Контроль SLA" },
  { href: "/settings", label: "Настройки уведомлений" },
];

const isActiveLink = (pathname: string, href: string) => pathname === href;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const currentSession = readAuthSession();

    if (!currentSession || currentSession.role !== "admin") {
      router.replace("/login");
      return;
    }

    setSession(currentSession);
    setReady(true);
  }, [router]);

  if (!ready || !session) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f5f8ff_0%,#eef3fb_40%,#f8fafc_100%)] px-4 py-6">
        <div className="mx-auto grid max-w-[1600px] gap-4">
          <div className="h-28 rounded-[28px] bg-white/90 shadow-[0_16px_50px_rgba(148,163,184,0.14)]" />
          <div className="grid gap-4 lg:grid-cols-[288px_minmax(0,1fr)]">
            <div className="h-[80vh] rounded-[28px] bg-slate-900/95" />
            <div className="h-[80vh] rounded-[28px] bg-white/90 shadow-[0_16px_50px_rgba(148,163,184,0.14)]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f5f8ff_0%,#eef3fb_40%,#f8fafc_100%)] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1600px] gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <aside className="hidden w-72 shrink-0 rounded-[26px] border border-slate-200/80 bg-[linear-gradient(180deg,#111827_0%,#172033_100%)] p-5 text-slate-100 shadow-[0_24px_64px_rgba(15,23,42,0.18)] lg:flex lg:flex-col">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-300/90">
              TouchSpace Admin
            </p>
            <h1 className="mt-3 text-[28px] font-semibold tracking-tight">
              Центр управления
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Операционный контур TouchSpace для контроля диалогов, команды, доступа и системных сигналов.
            </p>
          </div>

          <nav className="mt-8 flex flex-1 flex-col gap-2">
            {navigation.map((item) => {
              const active = isActiveLink(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-2xl border px-4 py-3 text-sm font-medium transition ${
                    active
                      ? "border-sky-300/55 bg-sky-400/12 text-white shadow-[inset_0_0_0_1px_rgba(125,211,252,0.18)]"
                      : "border-white/8 text-slate-200 hover:border-sky-300/30 hover:bg-white/6"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            <p className="font-medium text-white">{session.adminName ?? "Администратор"}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
              Рабочая сессия администратора
            </p>
            <button
              type="button"
              onClick={() => {
                void logoutServerSession(session).finally(() => {
                  clearAuthSession();
                  router.replace("/login");
                });
              }}
              className="mt-4 rounded-xl bg-white/10 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/16"
            >
              Выйти
            </button>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col gap-4">
          <header className="rounded-[24px] border border-slate-200/80 bg-white/88 px-5 py-3 shadow-[0_14px_36px_rgba(148,163,184,0.14)] backdrop-blur">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">
                  Панель администратора
                </p>
              </div>
            </div>
          </header>

          <main className="flex-1">{children}</main>
        </div>
      </div>
    </div>
  );
}
