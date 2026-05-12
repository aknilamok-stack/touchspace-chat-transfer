import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateSupplierRequestDto } from './dto/create-supplier-request.dto';
import { UpdateSupplierRequestStatusDto } from './dto/update-supplier-request-status.dto';
import { ProfilesService } from '../profiles.service';
import { PushService } from '../push.service';
import { ToggleSupplierRequestSyncDto } from './dto/toggle-supplier-request-sync.dto';
import { isSupplierRole } from '../role.utils';
import {
  buildSupplierRequestSyncPayload,
  getSupplierRequestSyncState,
  SUPPLIER_RESUME_ACTIVITY_WINDOW_MS,
  SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE,
} from './supplier-request-sync.util';

@Injectable()
export class SupplierRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesService: ProfilesService,
    private readonly pushService: PushService,
  ) {}

  private buildStatusChangedMessage(
    supplierName: string,
    status: UpdateSupplierRequestStatusDto['status'],
  ) {
    const statusLabel =
      status === 'closed'
        ? 'Решён'
        : status === 'answered'
          ? 'Отвечен'
          : status === 'cancelled'
            ? 'Отменён'
            : status;

    return `Запрос поставщику ${supplierName} переведён в статус "${statusLabel}"`;
  }

  private buildClaimedMessage(
    supplierName: string,
    assignedSupplierProfileName?: string | null,
  ) {
    const employeeName = assignedSupplierProfileName?.trim();
    const normalizedSupplierName = supplierName.trim().toLowerCase();
    const normalizedEmployeeName = employeeName?.toLowerCase();

    return employeeName && normalizedEmployeeName !== normalizedSupplierName
      ? `Поставщик ${supplierName} / ${employeeName} взял запрос в работу`
      : `Поставщик ${supplierName} взял запрос в работу`;
  }

  private buildReturnedToQueueMessage(supplierName: string) {
    return `Запрос поставщику ${supplierName} возвращён в общую очередь`;
  }

  private normalizeCompanyName(value?: string | null) {
    return value?.trim().toLowerCase() || null;
  }

  private supplierProfileMatchesRequestScope(
    profile: {
      id: string;
      role: string;
      supplierId?: string | null;
      companyName?: string | null;
    },
    supplierRequest: {
      supplierId?: string | null;
      supplierName: string;
    },
  ) {
    if (!isSupplierRole(profile.role)) {
      return false;
    }

    const requestSupplierId = supplierRequest.supplierId?.trim();

    if (
      requestSupplierId &&
      (profile.supplierId?.trim() === requestSupplierId ||
        profile.id.trim() === requestSupplierId)
    ) {
      return true;
    }

    return (
      this.normalizeCompanyName(profile.companyName) ===
      this.normalizeCompanyName(supplierRequest.supplierName)
    );
  }

  private async attachSyncState<
    T extends {
      id: string;
      ticketId: string;
      createdAt: Date;
    },
  >(requests: T[]) {
    if (requests.length === 0) {
      return [];
    }

    const uniqueTicketIds = [
      ...new Set(requests.map((request) => request.ticketId)),
    ];
    const controlMessages = await this.prisma.message.findMany({
      where: {
        ticketId: {
          in: uniqueTicketIds,
        },
        messageType: SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE,
      },
      select: {
        ticketId: true,
        content: true,
        createdAt: true,
        messageType: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const tickets = await this.prisma.ticket.findMany({
      where: {
        id: {
          in: uniqueTicketIds,
        },
      },
      select: {
        id: true,
        lastClientMessageAt: true,
        lastManagerReplyAt: true,
      },
    });

    const controlMessagesByTicketId = controlMessages.reduce<
      Record<
        string,
        Array<{
          content: string;
          createdAt: Date;
          messageType: string;
        }>
      >
    >((accumulator, message) => {
      if (!accumulator[message.ticketId]) {
        accumulator[message.ticketId] = [];
      }

      accumulator[message.ticketId].push(message);
      return accumulator;
    }, {});

    const requestsByTicketId = requests.reduce<Record<string, T[]>>(
      (accumulator, request) => {
        if (!accumulator[request.ticketId]) {
          accumulator[request.ticketId] = [];
        }

        accumulator[request.ticketId].push(request);
        return accumulator;
      },
      {},
    );

    const ticketsById = Object.fromEntries(
      tickets.map((ticket) => [ticket.id, ticket]),
    );

    return requests.map((request) => {
      const state = getSupplierRequestSyncState(
        requestsByTicketId[request.ticketId] ?? [],
        controlMessagesByTicketId[request.ticketId] ?? [],
        request.id,
      );
      const relatedTicket = ticketsById[request.ticketId];

      return {
        ...request,
        supplierSyncPaused: state.isPaused,
        supplierSyncMode: state.mode,
        supplierSyncAwaitingManager: state.isAwaitingManager,
        supplierSyncPausedAt: state.lastPausedAt,
        supplierSyncResumedAt: state.lastResumedAt,
        supplierSyncResumeRequestedAt: state.lastResumeRequestedAt,
        supplierSyncResumeDeferredAt: state.lastResumeDeferredAt,
        supplierSyncManagerPromptAvailableAt: state.managerPromptAvailableAt,
        supplierSyncRecentActivityAt: relatedTicket
          ? ([
              relatedTicket.lastClientMessageAt,
              relatedTicket.lastManagerReplyAt,
            ]
              .filter(Boolean)
              .map((value) => new Date(value as Date).toISOString())
              .sort()
              .at(-1) ?? null)
          : null,
      };
    });
  }

  async create(createSupplierRequestDto: CreateSupplierRequestDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: createSupplierRequestDto.ticketId },
      select: { id: true },
    });

    if (!ticket) {
      throw new NotFoundException(
        `Ticket with id "${createSupplierRequestDto.ticketId}" not found`,
      );
    }

    await this.profilesService.ensureProfile({
      id: createSupplierRequestDto.supplierId,
      fullName: createSupplierRequestDto.supplierName,
      role: createSupplierRequestDto.supplierId ? 'supplier' : null,
      supplierId: createSupplierRequestDto.supplierId ?? null,
    });

    await this.profilesService.ensureProfile({
      id: createSupplierRequestDto.createdByManagerId,
      fullName: createSupplierRequestDto.createdByManagerId ?? undefined,
      role: createSupplierRequestDto.createdByManagerId ? 'manager' : null,
    });

    const systemMessage = `Запрошен поставщик: ${createSupplierRequestDto.supplierName}. Комментарий: ${createSupplierRequestDto.requestText}`;

    const supplierRequest = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const createdSupplierRequest = await tx.supplierRequest.create({
        data: {
          ticketId: createSupplierRequestDto.ticketId,
          supplierId: createSupplierRequestDto.supplierId ?? null,
          supplierName: createSupplierRequestDto.supplierName,
          requestText: createSupplierRequestDto.requestText,
          status: createSupplierRequestDto.status ?? 'pending',
          slaMinutes: createSupplierRequestDto.slaMinutes ?? null,
          createdByManagerId:
            createSupplierRequestDto.createdByManagerId ?? null,
          claimRequiredAt: now,
          claimMissedAt: null,
          returnedToQueueAt: null,
          requestedAt: now,
          lastManagerMessageAt: now,
          lastSupplierReplyAt: null,
          responseStartedAt: now,
          firstResponseAt: null,
          respondedAt: null,
          responseTime: null,
          responseBreached: false,
        },
      });

      await tx.message.create({
        data: {
          ticketId: createSupplierRequestDto.ticketId,
          content: systemMessage,
          senderType: 'system',
          senderRole: 'system',
          status: 'sent',
          deliveryStatus: 'sent',
          messageType: 'system',
        },
      });

      await tx.ticket.update({
        where: { id: createSupplierRequestDto.ticketId },
        data: {
          status: 'waiting_supplier',
          supplierId: createSupplierRequestDto.supplierId ?? null,
          supplierName: createSupplierRequestDto.supplierName,
          supplierEscalatedAt: now,
          lastMessageAt: now,
        },
      });

      return createdSupplierRequest;
    });

    if (supplierRequest.supplierId) {
      void this.pushService
        .getActiveSupplierProfileIds(supplierRequest.supplierId)
        .then((supplierTargets) =>
          this.pushService.sendToProfiles(
            supplierTargets,
            {
              title: 'Новый запрос поставщику',
              body:
                supplierRequest.requestText.length > 120
                  ? `${supplierRequest.requestText.slice(0, 120)}...`
                  : supplierRequest.requestText,
              url: `/supplier?request=${supplierRequest.id}`,
              tag: `supplier-request-${supplierRequest.id}`,
            },
            'supplier_requests',
            supplierRequest.createdByManagerId ?? undefined,
          ),
        )
        .catch((error) =>
          console.error('Ошибка push-уведомления поставщику:', error),
        );
    }

    return supplierRequest;
  }

  async findByTicket(ticketId: string, supplierId?: string) {
    const normalizedSupplierId = supplierId?.trim();

    const requests = await this.prisma.supplierRequest.findMany({
      where: {
        ticketId,
        ...(normalizedSupplierId
          ? {
              OR: [
                { supplierId: normalizedSupplierId },
                { supplierName: normalizedSupplierId },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return this.attachSyncState(requests);
  }

  async findAll(supplierName?: string, supplierId?: string) {
    const normalizedSupplierName = supplierName?.trim();
    const normalizedSupplierId = supplierId?.trim();

    const requests = await this.prisma.supplierRequest.findMany({
      where: {
        ...(normalizedSupplierName && normalizedSupplierId
          ? {
              OR: [
                { supplierName: normalizedSupplierName },
                { supplierId: normalizedSupplierId },
              ],
            }
          : normalizedSupplierName
            ? { supplierName: normalizedSupplierName }
            : normalizedSupplierId
              ? { supplierId: normalizedSupplierId }
              : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return this.attachSyncState(requests);
  }

  async toggleSync(id: string, input: ToggleSupplierRequestSyncDto) {
    const actorId = input.actorId?.trim() || null;
    const actorName = input.actorName?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const supplierRequest = await tx.supplierRequest.findUnique({
        where: { id },
      });

      if (!supplierRequest) {
        throw new NotFoundException(
          `SupplierRequest with id "${id}" not found`,
        );
      }

      if (
        supplierRequest.status === 'closed' ||
        supplierRequest.status === 'cancelled' ||
        supplierRequest.closedAt
      ) {
        throw new BadRequestException(
          'Запрос уже завершён, пауза больше недоступна',
        );
      }

      if (input.action === 'pause' && input.actorType !== 'manager') {
        throw new BadRequestException(
          'Поставить запрос на паузу может только менеджер',
        );
      }

      if (input.action === 'resume' && input.actorType !== 'manager') {
        throw new BadRequestException(
          'Впустить поставщика в чат может только менеджер',
        );
      }

      if (input.action === 'resume_defer' && input.actorType !== 'manager') {
        throw new BadRequestException(
          'Отложить вход поставщика может только менеджер',
        );
      }

      if (input.action === 'resume_request') {
        if (input.actorType !== 'supplier') {
          throw new BadRequestException(
            'Вернуться в диалог может только поставщик',
          );
        }

        if (
          supplierRequest.assignedSupplierProfileId &&
          actorId &&
          supplierRequest.assignedSupplierProfileId !== actorId
        ) {
          throw new BadRequestException(
            'Этот запрос закреплён за другим сотрудником поставщика',
          );
        }
      }

      const ticketRequests = await tx.supplierRequest.findMany({
        where: {
          ticketId: supplierRequest.ticketId,
        },
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
          createdAt: true,
        },
      });

      const controlMessages = await tx.message.findMany({
        where: {
          ticketId: supplierRequest.ticketId,
          messageType: SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE,
        },
        select: {
          content: true,
          createdAt: true,
          messageType: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const state = getSupplierRequestSyncState(
        ticketRequests,
        controlMessages,
        supplierRequest.id,
      );

      const ticket = await tx.ticket.findUnique({
        where: {
          id: supplierRequest.ticketId,
        },
        select: {
          lastClientMessageAt: true,
          lastManagerReplyAt: true,
        },
      });

      const latestConversationActivityAtMs = Math.max(
        ticket?.lastClientMessageAt
          ? new Date(ticket.lastClientMessageAt).getTime()
          : Number.NEGATIVE_INFINITY,
        ticket?.lastManagerReplyAt
          ? new Date(ticket.lastManagerReplyAt).getTime()
          : Number.NEGATIVE_INFINITY,
      );
      const hasRecentConversationActivity =
        Number.isFinite(latestConversationActivityAtMs) &&
        Date.now() - latestConversationActivityAtMs <
          SUPPLIER_RESUME_ACTIVITY_WINDOW_MS;

      if (
        (input.action === 'pause' && state.isPaused) ||
        (input.action === 'resume' && !state.isPaused) ||
        (input.action === 'resume_request' &&
          (state.mode === 'awaiting_manager' || !state.isPaused)) ||
        (input.action === 'resume_defer' && state.mode !== 'awaiting_manager')
      ) {
        const [enrichedRequest] = await this.attachSyncState([supplierRequest]);
        return enrichedRequest;
      }

      const nextAction =
        input.action === 'resume_request'
          ? hasRecentConversationActivity
            ? 'resume_request'
            : 'resume'
          : input.action;

      await tx.message.create({
        data: {
          ticketId: supplierRequest.ticketId,
          content: buildSupplierRequestSyncPayload({
            kind: 'supplier_request_sync',
            requestId: supplierRequest.id,
            action: nextAction,
            actorType: input.actorType,
            actorId,
            actorName,
          }),
          senderType: 'system',
          senderRole: 'system',
          status: 'sent',
          deliveryStatus: 'sent',
          messageType: SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE,
          isInternal: true,
        },
      });

      const [updatedRequest] = await this.attachSyncState([supplierRequest]);
      return updatedRequest;
    });
  }

  async updateStatus(id: string, input: UpdateSupplierRequestStatusDto) {
    let resolvedAssignedSupplierProfileName =
      input.assignedSupplierProfileName?.trim() || null;

    let existingSupplierProfile: {
      id: string;
      fullName: string;
      role: string;
      supplierId: string | null;
      companyName: string | null;
    } | null = null;

    if (input.assignedSupplierProfileId?.trim()) {
      const normalizedAssignedSupplierProfileId =
        input.assignedSupplierProfileId.trim();
      existingSupplierProfile = await this.prisma.profile.findUnique({
        where: { id: normalizedAssignedSupplierProfileId },
        select: {
          id: true,
          fullName: true,
          role: true,
          supplierId: true,
          companyName: true,
        },
      });

      if (existingSupplierProfile?.fullName?.trim()) {
        resolvedAssignedSupplierProfileName =
          existingSupplierProfile.fullName.trim();
      } else {
        throw new BadRequestException(
          'Выбранный сотрудник поставщика не найден',
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const supplierRequest = await tx.supplierRequest.findUnique({
        where: { id },
      });

      if (!supplierRequest) {
        throw new NotFoundException(
          `SupplierRequest with id "${id}" not found`,
        );
      }

      if (
        existingSupplierProfile &&
        !this.supplierProfileMatchesRequestScope(
          existingSupplierProfile,
          supplierRequest,
        )
      ) {
        throw new BadRequestException(
          'Передать запрос можно только сотруднику этой же компании поставщика',
        );
      }

      const now = new Date();
      const nextStatus = input.status;
      const clearAssignedSupplier = Boolean(input.clearAssignedSupplier);
      const assignedSupplierProfileId =
        input.assignedSupplierProfileId?.trim() || null;
      const assignedSupplierProfileName = resolvedAssignedSupplierProfileName;
      const nextAssignedSupplierProfileId =
        clearAssignedSupplier && nextStatus === 'pending'
          ? null
          : (assignedSupplierProfileId ??
            supplierRequest.assignedSupplierProfileId);
      const nextAssignedSupplierProfileName =
        clearAssignedSupplier && nextStatus === 'pending'
          ? null
          : (assignedSupplierProfileName ??
            supplierRequest.assignedSupplierProfileName);
      const shouldStartNewWorkCycle =
        nextStatus === 'in_progress' &&
        (supplierRequest.status !== 'in_progress' ||
          supplierRequest.assignedSupplierProfileId !==
            nextAssignedSupplierProfileId);

      const updatedSupplierRequest = await tx.supplierRequest.update({
        where: { id },
        data: {
          status: nextStatus,
          assignedSupplierProfileId: nextAssignedSupplierProfileId,
          assignedSupplierProfileName: nextAssignedSupplierProfileName,
          claimedAt: shouldStartNewWorkCycle
            ? now
            : nextStatus === 'in_progress'
              ? (supplierRequest.claimedAt ?? now)
              : nextStatus === 'pending' && clearAssignedSupplier
                ? null
                : supplierRequest.claimedAt,
          claimMissedAt:
            nextStatus === 'in_progress' ? null : supplierRequest.claimMissedAt,
          returnedToQueueAt:
            nextStatus === 'pending' ? now : supplierRequest.returnedToQueueAt,
          lastSupplierReplyAt:
            nextStatus === 'answered' || nextStatus === 'closed'
              ? now
              : supplierRequest.lastSupplierReplyAt,
          respondedAt:
            nextStatus === 'answered' ? now : supplierRequest.respondedAt,
          closedAt: nextStatus === 'closed' ? now : null,
        },
      });

      const shouldCreateClaimMessage =
        nextStatus === 'in_progress' &&
        Boolean(assignedSupplierProfileId) &&
        (supplierRequest.assignedSupplierProfileId !==
          assignedSupplierProfileId ||
          supplierRequest.status === 'pending');

      await tx.message.create({
        data: {
          ticketId: supplierRequest.ticketId,
          content:
            nextStatus === 'pending' && clearAssignedSupplier
              ? this.buildReturnedToQueueMessage(supplierRequest.supplierName)
              : shouldCreateClaimMessage
                ? this.buildClaimedMessage(
                    supplierRequest.supplierName,
                    assignedSupplierProfileName,
                  )
                : this.buildStatusChangedMessage(
                    supplierRequest.supplierName,
                    nextStatus,
                  ),
          senderType: 'system',
          senderRole: 'system',
          status: 'sent',
          deliveryStatus: 'sent',
          messageType: 'system',
        },
      });

      if (nextStatus === 'answered') {
        await tx.ticket.update({
          where: { id: supplierRequest.ticketId },
          data: {
            status: 'in_progress',
            lastMessageAt: now,
          },
        });
      } else if (nextStatus === 'closed') {
        await tx.ticket.update({
          where: { id: supplierRequest.ticketId },
          data: {
            status: 'in_progress',
            lastMessageAt: now,
          },
        });
      } else {
        await tx.ticket.update({
          where: { id: supplierRequest.ticketId },
          data: {
            lastMessageAt: now,
          },
        });
      }

      return updatedSupplierRequest;
    });
  }
}
