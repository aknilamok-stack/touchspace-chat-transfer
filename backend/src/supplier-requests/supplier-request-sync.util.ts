export const SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE = 'supplier_control';
export const SUPPLIER_RESUME_ACTIVITY_WINDOW_MS = 5 * 60 * 1000;
export const SUPPLIER_RESUME_REMINDER_MS = 2 * 60 * 1000;

export type SupplierRequestSyncAction =
  | 'pause'
  | 'resume'
  | 'resume_request'
  | 'resume_defer';
export type SupplierRequestSyncActorType = 'manager' | 'supplier';

export type SupplierRequestSyncPayload = {
  kind: 'supplier_request_sync';
  requestId: string;
  action: SupplierRequestSyncAction;
  actorType: SupplierRequestSyncActorType;
  actorId?: string | null;
  actorName?: string | null;
};

type RequestWindowLike = {
  id: string;
  createdAt: Date | string;
};

type ControlMessageLike = {
  content: string;
  createdAt: Date | string;
  messageType?: string | null;
};

export const buildSupplierRequestSyncPayload = (
  payload: SupplierRequestSyncPayload,
) => JSON.stringify(payload);

export const parseSupplierRequestSyncPayload = (
  content: string,
): SupplierRequestSyncPayload | null => {
  try {
    const parsed = JSON.parse(content) as Partial<SupplierRequestSyncPayload>;
    const action = parsed.action;

    if (
      parsed.kind !== 'supplier_request_sync' ||
      typeof parsed.requestId !== 'string' ||
      (action !== 'pause' &&
        action !== 'resume' &&
        action !== 'resume_request' &&
        action !== 'resume_defer') ||
      (parsed.actorType !== 'manager' && parsed.actorType !== 'supplier')
    ) {
      return null;
    }

    return {
      kind: 'supplier_request_sync',
      requestId: parsed.requestId,
      action,
      actorType: parsed.actorType,
      actorId:
        typeof parsed.actorId === 'string' && parsed.actorId.trim()
          ? parsed.actorId.trim()
          : null,
      actorName:
        typeof parsed.actorName === 'string' && parsed.actorName.trim()
          ? parsed.actorName.trim()
          : null,
    };
  } catch {
    return null;
  }
};

export const getSupplierRequestSyncState = (
  requests: RequestWindowLike[],
  messages: ControlMessageLike[],
  requestId: string,
  options?: {
    nowMs?: number;
  },
) => {
  const nowMs = options?.nowMs ?? Date.now();
  const sortedRequests = [...requests].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
  const requestIndex = sortedRequests.findIndex((request) => request.id === requestId);

  if (requestIndex < 0) {
    return {
      mode: 'live' as const,
      isPaused: false,
      isAwaitingManager: false,
      lastPausedAt: null as string | null,
      lastResumedAt: null as string | null,
      lastResumeRequestedAt: null as string | null,
      lastResumeDeferredAt: null as string | null,
      effectiveResumeAt: null as string | null,
      managerPromptAvailableAt: null as string | null,
    };
  }

  const request = sortedRequests[requestIndex];
  const requestStartedAt = new Date(request.createdAt).getTime();
  const requestEndedAt =
    requestIndex < sortedRequests.length - 1
      ? new Date(sortedRequests[requestIndex + 1].createdAt).getTime()
      : Number.POSITIVE_INFINITY;

  const events = messages
    .filter(
      (message) =>
        message.messageType === SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE &&
        Number.isFinite(new Date(message.createdAt).getTime()),
    )
    .map((message) => ({
      createdAt: new Date(message.createdAt).toISOString(),
      timestamp: new Date(message.createdAt).getTime(),
      payload: parseSupplierRequestSyncPayload(message.content),
    }))
    .filter(
      (event): event is { createdAt: string; timestamp: number; payload: SupplierRequestSyncPayload } => {
        if (!event.payload) {
          return false;
        }

        return (
          event.payload.requestId === requestId &&
          event.timestamp >= requestStartedAt &&
          event.timestamp < requestEndedAt
        );
      },
    )
    .sort((left, right) => left.timestamp - right.timestamp);

  let isPaused = false;
  let isAwaitingManager = false;
  let lastPausedAt: string | null = null;
  let lastResumedAt: string | null = null;
  let lastResumeRequestedAt: string | null = null;
  let lastResumeDeferredAt: string | null = null;
  let managerPromptAvailableAt: string | null = null;
  let autoResumeAt: string | null = null;

  for (const event of events) {
    if (event.payload.action === 'pause') {
      isPaused = true;
      isAwaitingManager = false;
      autoResumeAt = null;
      lastPausedAt = event.createdAt;
      continue;
    }

    if (event.payload.action === 'resume') {
      isPaused = false;
      isAwaitingManager = false;
      autoResumeAt = null;
      lastResumedAt = event.createdAt;
      continue;
    }

    if (event.payload.action === 'resume_request') {
      isPaused = true;
      isAwaitingManager = true;
      lastResumeRequestedAt = event.createdAt;
      lastResumeDeferredAt = null;
      managerPromptAvailableAt = event.createdAt;
      autoResumeAt = new Date(
        event.timestamp + SUPPLIER_RESUME_REMINDER_MS,
      ).toISOString();
      continue;
    }

    if (event.payload.action === 'resume_defer') {
      isPaused = true;
      isAwaitingManager = true;
      lastResumeDeferredAt = event.createdAt;
      managerPromptAvailableAt = new Date(
        event.timestamp + SUPPLIER_RESUME_REMINDER_MS,
      ).toISOString();
      autoResumeAt = new Date(
        event.timestamp + SUPPLIER_RESUME_REMINDER_MS * 2,
      ).toISOString();
    }
  }

  let effectiveResumeAt: string | null = null;

  if (
    isPaused &&
    isAwaitingManager &&
    autoResumeAt
  ) {
    const autoResumeAtMs = new Date(autoResumeAt).getTime();

    if (Number.isFinite(autoResumeAtMs) && nowMs >= autoResumeAtMs) {
      isPaused = false;
      isAwaitingManager = false;
      effectiveResumeAt = new Date(autoResumeAtMs).toISOString();
      lastResumedAt = effectiveResumeAt;
    }
  }

  return {
    mode: isPaused ? (isAwaitingManager ? 'awaiting_manager' : 'paused') : 'live',
    isPaused,
    isAwaitingManager,
    lastPausedAt,
    lastResumedAt,
    lastResumeRequestedAt,
    lastResumeDeferredAt,
    effectiveResumeAt,
    managerPromptAvailableAt,
  };
};
