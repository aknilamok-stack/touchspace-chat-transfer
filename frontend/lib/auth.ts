import { apiUrl } from "@/lib/api";

export type UserRole =
  | "admin"
  | "client"
  | "manager"
  | "supplier"
  | "manager_supervisor"
  | "supplier_supervisor";
export type ManagerPresence = "online" | "break" | "offline";

export type AuthSession = {
  login: string;
  role: UserRole;
  chatAccessEnabled?: boolean;
  sessionToken?: string;
  userId?: string;
  fullName?: string;
  email?: string;
  companyName?: string;
  passwordChangeRequired?: boolean;
  adminId?: string;
  adminName?: string;
  managerId?: string;
  managerName?: string;
  supplierId?: string;
  supplierName?: string;
};

export const adminAccounts = [
  { login: "admin", password: "admin123", id: "admin_touchspace", name: "TouchSpace Admin" },
] as const;

export const managerAccounts = [
  { login: "manager", password: "manager123", id: "manager_anna", name: "Анна" },
  { login: "anna", password: "manager123", id: "manager_anna", name: "Анна" },
  {
    login: "ekaterina",
    password: "manager123",
    id: "manager_ekaterina",
    name: "Екатерина",
  },
  { login: "mikhail", password: "manager123", id: "manager_mikhail", name: "Михаил" },
] as const;

export const supplierAccounts = [
  { login: "supplier", password: "supplier123", id: "supplier_karelia", name: "Karelia" },
] as const;

export const managerSupervisorAccounts = [
  {
    login: "managerlead",
    password: "managerlead123",
    id: "manager_supervisor_touchspace",
    name: "Управленец менеджеров",
  },
] as const;

export const supplierSupervisorAccounts = [
  {
    login: "supplierlead",
    password: "supplierlead123",
    id: "supplier_supervisor_karelia",
    name: "Управленец поставщика",
    supplierId: "supplier_karelia",
  },
] as const;

export const authStorageKey = "touchspace_auth";
const clientSessionStorageKey = "touchspace_client_session";
const managerStatusStorageKey = "touchspace_manager_statuses";

function readDesktopStoredAuthRaw() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.touchspaceDesktop?.authStorage?.get() ?? null;
  } catch {
    return null;
  }
}

function writeDesktopStoredAuthRaw(rawValue: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.touchspaceDesktop?.authStorage?.set(rawValue);
  } catch {
    return;
  }
}

function clearDesktopStoredAuth() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.touchspaceDesktop?.authStorage?.clear();
  } catch {
    return;
  }
}

export function readAuthSession(): AuthSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(authStorageKey) ?? readDesktopStoredAuthRaw();

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as AuthSession;

    if (!window.localStorage.getItem(authStorageKey)) {
      window.localStorage.setItem(authStorageKey, rawValue);
    }

    return parsed;
  } catch {
    window.localStorage.removeItem(authStorageKey);
    clearDesktopStoredAuth();
    return null;
  }
}

export function isManagerRole(role?: string | null): role is "manager" | "manager_supervisor" {
  return role === "manager" || role === "manager_supervisor";
}

export function isSupplierRole(role?: string | null): role is "supplier" | "supplier_supervisor" {
  return role === "supplier" || role === "supplier_supervisor";
}

export function isInternalRole(role?: string | null) {
  return role === "admin" || isManagerRole(role) || isSupplierRole(role);
}

export function getHomePathForRole(role?: string | null) {
  if (role === "admin") {
    return "/admin";
  }

  if (role === "manager_supervisor") {
    return "/manager-supervisor";
  }

  if (role === "supplier_supervisor") {
    return "/supplier-supervisor";
  }

  if (isSupplierRole(role)) {
    return "/supplier";
  }

  return "/";
}

export function writeAuthSession(session: AuthSession) {
  const rawValue = JSON.stringify(session);
  window.localStorage.setItem(authStorageKey, rawValue);
  writeDesktopStoredAuthRaw(rawValue);
}

export function clearAuthSession() {
  window.localStorage.removeItem(authStorageKey);
  clearDesktopStoredAuth();
}

export async function validateServerSession(session: AuthSession) {
  if (!session.userId || !session.sessionToken) {
    return {
      valid: true,
    };
  }

  const response = await fetch(apiUrl("/auth/validate-session"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      userId: session.userId,
      sessionToken: session.sessionToken,
    }),
  });

  if (!response.ok) {
    throw new Error("Не удалось проверить активную сессию");
  }

  return (await response.json()) as {
    valid: boolean;
    reason?: string;
  };
}

export async function logoutServerSession(session: AuthSession | null) {
  if (!session?.userId) {
    return;
  }

  try {
    await fetch(apiUrl("/auth/logout"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: session.userId,
        sessionToken: session.sessionToken,
      }),
    });
  } catch {
    return;
  }
}

export function readManagerStatuses(): Record<string, ManagerPresence> {
  if (typeof window === "undefined") {
    return {};
  }

  const rawValue = window.localStorage.getItem(managerStatusStorageKey);

  if (!rawValue) {
    return {};
  }

  try {
    return JSON.parse(rawValue) as Record<string, ManagerPresence>;
  } catch {
    window.localStorage.removeItem(managerStatusStorageKey);
    return {};
  }
}

export function writeManagerStatus(managerId: string, status: ManagerPresence) {
  const currentStatuses = readManagerStatuses();
  currentStatuses[managerId] = status;
  window.localStorage.setItem(managerStatusStorageKey, JSON.stringify(currentStatuses));
}

export type ClientSession = {
  clientId: string;
  clientName: string;
  tradePointId?: string;
  tradePointExternalId?: string;
  tradePointName?: string;
  platformUserId?: string;
  platformUserName?: string;
  currentUserId?: string;
  currentUserLogin?: string;
  currentUserEmail?: string;
  currentUserPhone?: string;
  currentUserXmlId?: string;
  isSuperuser?: boolean;
  superuserId?: string;
  superuserEmail?: string;
  superuserPhone?: string;
  canonicalEmail?: string;
  canonicalEmailSource?: string;
  userToken?: string;
  email?: string;
  phone?: string;
};

export function writeClientSession(session: ClientSession) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(clientSessionStorageKey, JSON.stringify(session));
}

export function getOrCreateClientSession(): ClientSession {
  if (typeof window === "undefined") {
    return {
      clientId: "client_browser",
      clientName: "Клиент",
    };
  }

  const rawValue = window.localStorage.getItem(clientSessionStorageKey);

  if (rawValue) {
    try {
      return JSON.parse(rawValue) as ClientSession;
    } catch {
      window.localStorage.removeItem(clientSessionStorageKey);
    }
  }

  const session = {
    clientId:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `client_${crypto.randomUUID()}`
        : `client_${Date.now()}`,
    clientName: "Клиент",
  } satisfies ClientSession;

  writeClientSession(session);
  return session;
}
