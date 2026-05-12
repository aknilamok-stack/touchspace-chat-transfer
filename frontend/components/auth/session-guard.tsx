"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  clearAuthSession,
  isInternalRole,
  readAuthSession,
  validateServerSession,
} from "@/lib/auth";

const publicPaths = new Set(["/login", "/client", "/chat-app"]);

export function SessionGuard() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!pathname || publicPaths.has(pathname)) {
      return;
    }

    const session = readAuthSession();

    if (!session) {
      return;
    }

    if (isInternalRole(session.role) && (!session.userId || !session.sessionToken)) {
      clearAuthSession();
      router.replace("/login?reason=reauth-required");
      return;
    }

    if (!session.userId || !session.sessionToken) {
      return;
    }

    let isCancelled = false;

    const verifySession = async () => {
      try {
        const currentSession = readAuthSession();

        if (
          !currentSession ||
          currentSession.userId !== session.userId ||
          currentSession.sessionToken !== session.sessionToken
        ) {
          return;
        }

        const result = await validateServerSession(currentSession);

        if (isCancelled || result.valid) {
          return;
        }

        clearAuthSession();
        router.replace("/login?reason=other-device");
      } catch (error) {
        console.error("Ошибка проверки активной сессии:", error);
      }
    };

    void verifySession();

    const intervalId = window.setInterval(() => {
      void verifySession();
    }, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void verifySession();
      }
    };

    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [pathname, router]);

  return null;
}
