export type IncomingClientContext = {
  clientId?: string;
  clientName?: string;
  tradePointId?: string;
  tradePointExternalId?: string;
  tradePointName?: string;
  currentUserId?: string;
  currentUserEmail?: string;
  currentUserPhone?: string;
  currentUserXmlId?: string;
  isSuperuser?: boolean | string;
  superuserId?: string;
  superuserEmail?: string;
  superuserPhone?: string;
  canonicalEmail?: string;
  canonicalEmailSource?: string;
  clientEmail?: string;
  clientPhone?: string;
};

type ExistingClientContext = {
  clientId?: string | null;
  clientName?: string | null;
  tradePointExternalId?: string | null;
  tradePointName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  currentUserId?: string | null;
  currentUserEmail?: string | null;
  currentUserPhone?: string | null;
  currentUserXmlId?: string | null;
  isSuperuser?: boolean | null;
  superuserId?: string | null;
  superuserEmail?: string | null;
  superuserPhone?: string | null;
  canonicalEmail?: string | null;
  canonicalEmailSource?: string | null;
  lockedBySuperuser?: boolean | null;
};

const normalizeString = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizeBoolean = (value?: boolean | string | null) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }

  return null;
};

const normalizeCanonicalSource = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase();
  if (
    normalized === 'superuser' ||
    normalized === 'employee_fallback' ||
    normalized === 'manual'
  ) {
    return normalized;
  }

  return null;
};

export const resolveTicketClientContext = (
  incoming: IncomingClientContext,
  existing?: ExistingClientContext,
) => {
  const tradePointId =
    normalizeString(incoming.tradePointId) ||
    normalizeString(incoming.clientId) ||
    normalizeString(existing?.clientId);
  const tradePointName =
    normalizeString(incoming.tradePointName) ||
    normalizeString(incoming.clientName) ||
    normalizeString(existing?.tradePointName) ||
    normalizeString(existing?.clientName);
  const tradePointExternalId =
    normalizeString(incoming.tradePointExternalId) ||
    normalizeString(existing?.tradePointExternalId);
  const currentUserId =
    normalizeString(incoming.currentUserId) ||
    normalizeString(existing?.currentUserId);
  const currentUserEmail =
    normalizeString(incoming.currentUserEmail) ||
    normalizeString(existing?.currentUserEmail);
  const currentUserPhone =
    normalizeString(incoming.currentUserPhone) ||
    normalizeString(existing?.currentUserPhone) ||
    normalizeString(incoming.clientPhone) ||
    normalizeString(existing?.clientPhone);
  const currentUserXmlId =
    normalizeString(incoming.currentUserXmlId) ||
    normalizeString(existing?.currentUserXmlId);
  const isSuperuser =
    normalizeBoolean(incoming.isSuperuser) ?? normalizeBoolean(existing?.isSuperuser);
  const superuserId =
    normalizeString(incoming.superuserId) ||
    normalizeString(existing?.superuserId);
  const superuserEmail =
    normalizeString(incoming.superuserEmail) ||
    normalizeString(existing?.superuserEmail);
  const superuserPhone =
    normalizeString(incoming.superuserPhone) ||
    normalizeString(existing?.superuserPhone);
  const requestedCanonicalEmail =
    normalizeString(incoming.canonicalEmail) ||
    normalizeString(existing?.canonicalEmail);
  const requestedCanonicalSource =
    normalizeCanonicalSource(incoming.canonicalEmailSource) ||
    normalizeCanonicalSource(existing?.canonicalEmailSource);
  const hasSuperuserLock =
    Boolean(existing?.lockedBySuperuser) ||
    requestedCanonicalSource === 'superuser' ||
    (isSuperuser === true && Boolean(superuserEmail));

  const fallbackCanonicalEmail =
    requestedCanonicalEmail ||
    superuserEmail ||
    currentUserEmail ||
    normalizeString(incoming.clientEmail) ||
    normalizeString(existing?.clientEmail);

  let canonicalEmail = normalizeString(existing?.canonicalEmail);
  let canonicalEmailSource =
    normalizeCanonicalSource(existing?.canonicalEmailSource) || null;
  let lockedBySuperuser = Boolean(existing?.lockedBySuperuser);

  if (hasSuperuserLock) {
    canonicalEmail = superuserEmail || fallbackCanonicalEmail;
    canonicalEmailSource = 'superuser';
    lockedBySuperuser = Boolean(canonicalEmail);
  } else if (!canonicalEmail && fallbackCanonicalEmail) {
    canonicalEmail = fallbackCanonicalEmail;
    canonicalEmailSource = requestedCanonicalSource || 'employee_fallback';
  } else if (
    canonicalEmail &&
    requestedCanonicalSource === 'manual' &&
    requestedCanonicalEmail
  ) {
    canonicalEmail = requestedCanonicalEmail;
    canonicalEmailSource = 'manual';
  }

  const displayPhone =
    superuserPhone ||
    currentUserPhone ||
    normalizeString(incoming.clientPhone) ||
    normalizeString(existing?.clientPhone);

  return {
    clientId: tradePointId,
    clientName: tradePointName,
    tradePointName,
    tradePointExternalId,
    currentUserId,
    currentUserEmail,
    currentUserPhone,
    currentUserXmlId,
    isSuperuser,
    superuserId,
    superuserEmail,
    superuserPhone,
    canonicalEmail,
    canonicalEmailSource,
    lockedBySuperuser,
    clientEmail: canonicalEmail,
    clientPhone: displayPhone,
  };
};
