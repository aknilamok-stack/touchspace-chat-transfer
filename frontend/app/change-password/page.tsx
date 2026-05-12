"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api";
import { getHomePathForRole, readAuthSession, writeAuthSession } from "@/lib/auth";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const session = readAuthSession();

  useEffect(() => {
    if (!session) {
      router.replace("/login");
      return;
    }

    if (!session.passwordChangeRequired) {
      router.replace(getHomePathForRole(session.role));
    }
  }, [router, session]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!session?.userId) {
      setError("Сессия пользователя не найдена");
      return;
    }

    if (newPassword.trim().length < 8) {
      setError("Новый пароль должен быть не короче 8 символов");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }

    setSubmitting(true);

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
        const text = await response.text();
        throw new Error(text || "Не удалось сменить пароль");
      }

      writeAuthSession({
        ...session,
        passwordChangeRequired: false,
      });

      setSuccess("Пароль обновлён. Перенаправляем...");

      window.setTimeout(() => {
        router.replace(getHomePathForRole(session.role));
      }, 700);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось сменить пароль");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#F3F6FB] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0A84FF]">
          TouchSpace Chat
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-[#1E1E1E]">
          Смена временного пароля
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          При первом входе нужно сразу задать новый пароль для дальнейшей работы.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 outline-none text-[#1E1E1E]"
            placeholder="Текущий временный пароль"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 outline-none text-[#1E1E1E]"
            placeholder="Новый пароль"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 outline-none text-[#1E1E1E]"
            placeholder="Повторите новый пароль"
          />

          {error && <p className="text-sm text-red-500">{error}</p>}
          {success && <p className="text-sm text-emerald-600">{success}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-[#0A84FF] py-3 font-medium text-white disabled:opacity-60"
          >
            {submitting ? "Сохраняем..." : "Сменить пароль"}
          </button>
        </form>
      </div>
    </main>
  );
}
