"use client";

import { useEffect, useState } from "react";
import { isDesktopShell } from "@/lib/runtime";

export function DesktopOfflineGuard() {
  const [desktopMode, setDesktopMode] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setDesktopMode(isDesktopShell());
    setIsOffline(window.navigator.onLine === false);

    const syncNetworkState = () => {
      setIsOffline(window.navigator.onLine === false);
    };

    window.addEventListener("online", syncNetworkState);
    window.addEventListener("offline", syncNetworkState);
    window.addEventListener("focus", syncNetworkState);
    document.addEventListener("visibilitychange", syncNetworkState);

    return () => {
      window.removeEventListener("online", syncNetworkState);
      window.removeEventListener("offline", syncNetworkState);
      window.removeEventListener("focus", syncNetworkState);
      document.removeEventListener("visibilitychange", syncNetworkState);
    };
  }, []);

  if (!desktopMode || !isOffline) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] bg-slate-950/38 backdrop-blur-[2px]">
      <div className="flex min-h-full items-center justify-center p-5">
        <div className="w-full max-w-[520px] rounded-[28px] border border-amber-200 bg-white p-6 shadow-[0_30px_80px_rgba(15,23,42,0.22)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">
            TouchSpace Desktop
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
            Нет доступа к сети
          </h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">
            Приложение не будет выходить из вашей учётной записи. Как только соединение восстановится,
            это окно закроется автоматически.
          </p>
          <div className="mt-5 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-600">
            Проверьте подключение к интернету или доступ к рабочей сети. TouchSpace продолжит работу после
            восстановления соединения.
          </div>
        </div>
      </div>
    </div>
  );
}
