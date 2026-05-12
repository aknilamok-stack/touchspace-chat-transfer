export const MANAGER_ROLES = ['manager', 'manager_supervisor'] as const;
export const SUPPLIER_ROLES = ['supplier', 'supplier_supervisor'] as const;

export function isManagerRole(role?: string | null) {
  return Boolean(role && MANAGER_ROLES.includes(role as (typeof MANAGER_ROLES)[number]));
}

export function isSupplierRole(role?: string | null) {
  return Boolean(role && SUPPLIER_ROLES.includes(role as (typeof SUPPLIER_ROLES)[number]));
}

export function getDefaultFullNameForRole(role?: string | null) {
  if (role === 'admin') {
    return 'Администратор';
  }

  if (isSupplierRole(role)) {
    return 'Поставщик';
  }

  return 'Менеджер';
}
