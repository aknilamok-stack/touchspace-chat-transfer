"use client";

import { apiUrl } from "@/lib/api";
import { readAuthSession } from "@/lib/auth";

type QueryValue = string | number | boolean | null | undefined;

const encodeHeaderValue = (value: string) => encodeURIComponent(value);

const getAdminHeaders = () => {
  const session = readAuthSession();

  if (!session || session.role !== "admin") {
    throw new Error("Admin session is required");
  }

  return {
    "Content-Type": "application/json",
    "x-touchspace-admin-role": "admin",
    "x-touchspace-admin-id": encodeHeaderValue(session.adminId ?? "admin_touchspace"),
    "x-touchspace-admin-name": encodeHeaderValue(session.adminName ?? "TouchSpace Admin"),
  };
};

const buildUrl = (path: string, query?: Record<string, QueryValue>) => {
  const url = new URL(apiUrl(path));

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

export async function adminRequest<T>(
  path: string,
  init?: RequestInit,
  query?: Record<string, QueryValue>,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(buildUrl(path, query), {
      ...init,
      headers: {
        ...getAdminHeaders(),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Failed to fetch") {
      throw new Error("Не удалось подключиться к backend. Проверь, что backend доступен и корректно указан в NEXT_PUBLIC_API_BASE_URL.");
    }

    throw error;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const adminApi = {
  getOverview: (query?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/overview", undefined, query),
  getRegistrations: (query?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/registrations", undefined, query),
  getRegistration: (id: string) => adminRequest<any>(`/admin/registrations/${id}`),
  createRegistration: (payload: Record<string, unknown>) =>
    adminRequest<any>("/admin/registrations", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  approveRegistration: (id: string, payload: Record<string, unknown>) =>
    adminRequest<any>(`/admin/registrations/${id}/approve`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  rejectRegistration: (id: string, payload: Record<string, unknown>) =>
    adminRequest<any>(`/admin/registrations/${id}/reject`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  getUsers: (query?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/users", undefined, query),
  getUser: (id: string) => adminRequest<any>(`/admin/users/${id}`),
  createUser: (payload: Record<string, unknown>) =>
    adminRequest<any>("/admin/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateUser: (id: string, payload: Record<string, unknown>) =>
    adminRequest<any>(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  reissueUserPassword: (id: string) =>
    adminRequest<any>(`/admin/users/${id}/reissue-password`, {
      method: "POST",
    }),
  deleteUser: (id: string) =>
    adminRequest<any>(`/admin/users/${id}`, {
      method: "DELETE",
    }),
  getDialogs: (query?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/dialogs", undefined, query),
  getDialog: (id: string, query?: Record<string, QueryValue>) =>
    adminRequest<any>(`/admin/dialogs/${id}`, undefined, query),
  analyzeDialogAi: (id: string) =>
    adminRequest<any>(`/admin/dialogs/${id}/ai-analyze`, {
      method: "POST",
    }),
  generateClientDialogAiSummary: (id: string, payload?: Record<string, QueryValue>) =>
    adminRequest<any>(`/admin/dialogs/${id}/client-ai-summary`, {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }),
  getAnalyticsOverview: (query?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/analytics/overview", undefined, query),
  getInsightsAnalytics: (query?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/analytics/insights", undefined, query),
  generateInsightsAiSummary: (payload?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/analytics/insights/ai-summary", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }),
  generateReasonsAiSummary: (payload?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/analytics/reasons/ai-summary", {
      method: "POST",
      body: JSON.stringify(payload ?? {}),
    }),
  getManagersAnalytics: (query?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/analytics/managers", undefined, query),
  getManagerAnalyticsDetail: (id: string, query?: Record<string, QueryValue>) =>
    adminRequest<any>(`/admin/analytics/managers/${id}`, undefined, query),
  getSuppliersAnalytics: (query?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/analytics/suppliers", undefined, query),
  getSupplierAnalyticsDetail: (id: string, query?: Record<string, QueryValue>) =>
    adminRequest<any>(`/admin/analytics/suppliers/${id}`, undefined, query),
  getSlaSummary: (query?: Record<string, QueryValue>) =>
    adminRequest<any>("/admin/sla", undefined, query),
};
