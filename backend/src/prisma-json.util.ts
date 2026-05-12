import { Prisma } from '@prisma/client';

export const readJsonStringArray = (
  value: Prisma.JsonValue | Prisma.InputJsonValue | null | undefined,
): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
};
