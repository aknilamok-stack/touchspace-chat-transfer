import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ProfilesService } from './profiles.service';
import { isManagerRole, isSupplierRole } from './role.utils';
import {
  getSupplierRequestSyncState,
  SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE,
} from './supplier-requests/supplier-request-sync.util';

const MANAGER_SUPPLIER_CLIENT_ESCALATION_MS = 2 * 60 * 1000;

type NotificationPreferencesInput = {
  notificationPushEnabled?: boolean;
  notifyClientChats?: boolean;
  notifySupplierChats?: boolean;
  notifySupplierRequests?: boolean;
  notifyAiHandoffs?: boolean;
  notifyAdminAlerts?: boolean;
};

type ManagerNotificationCandidate = {
  notificationKey: string;
  ticketId: string;
  title: string;
  clientName: string | null;
  tradePointName?: string | null;
  messageId: string;
  messageText: string;
  createdAt: Date;
  avatarColor?: string | null;
  avatarEmoji?: string | null;
  conversationMode?: string | null;
  scopeStatus:
    | 'new_unclaimed'
    | 'missed_unclaimed'
    | 'rescue_queue'
    | 'owned_active'
    | 'claimed_by_other_recently';
  waitSeconds: number;
  assignedManagerId: string | null;
  assignedManagerName: string | null;
};

type SupplierNotificationCandidate = {
  notificationKey: string;
  ticketId: string;
  requestId: string | null;
  title: string;
  messageId: string;
  messageText: string;
  createdAt: Date;
  senderType?: 'manager' | 'client' | null;
  tradePointName?: string | null;
  avatarColor?: string | null;
  avatarEmoji?: string | null;
  scopeStatus:
    | 'new_unclaimed'
    | 'missed_unclaimed'
    | 'owned_active'
    | 'claimed_by_other_recently';
  waitSeconds: number;
  assignedSupplierProfileId?: string | null;
  assignedSupplierProfileName?: string | null;
  kind: 'message' | 'request';
};

type SupplierNotificationRequestRecord = {
  id: string;
  status: string;
  createdAt: Date;
  ticketId: string;
  supplierId?: string | null;
  supplierName: string;
  requestText: string;
  assignedSupplierProfileId: string | null;
  assignedSupplierProfileName: string | null;
  claimRequiredAt: Date | null;
  claimMissedAt: Date | null;
  claimedAt: Date | null;
  lastManagerMessageAt: Date | null;
  lastSupplierReplyAt: Date | null;
  respondedAt?: Date | null;
  closedAt: Date | null;
  ticket: {
    status: string | null;
    title: string | null;
    tradePointName: string | null;
    clientName: string | null;
    avatarColor: string | null;
    avatarEmoji: string | null;
    supplierId?: string | null;
    supplierName?: string | null;
  } | null;
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesService: ProfilesService,
  ) {}

  private async resolveScopedRole(profileId: string, fallbackRole: string) {
    const existingProfile = await this.prisma.profile.findUnique({
      where: { id: profileId },
      select: { role: true },
    });

    if (isManagerRole(fallbackRole) && isManagerRole(existingProfile?.role)) {
      return existingProfile?.role ?? fallbackRole;
    }

    if (isSupplierRole(fallbackRole) && isSupplierRole(existingProfile?.role)) {
      return existingProfile?.role ?? fallbackRole;
    }

    return existingProfile?.role?.trim() || fallbackRole;
  }

  private async ensureSettingsProfile(profileId: string, role: string) {
    const normalizedProfileId = profileId?.trim();
    const normalizedRole = role?.trim();

    if (!normalizedProfileId || !normalizedRole) {
      throw new BadRequestException('profileId и role обязательны');
    }

    const resolvedRole = await this.resolveScopedRole(
      normalizedProfileId,
      normalizedRole,
    );

    await this.profilesService.ensureProfile({
      id: normalizedProfileId,
      role: resolvedRole,
    });

    const profile = await this.prisma.profile.findUnique({
      where: { id: normalizedProfileId },
      select: {
        id: true,
        role: true,
        fullName: true,
        email: true,
        supplierId: true,
        chatAccessEnabled: true,
        notificationPushEnabled: true,
        notifyClientChats: true,
        notifySupplierChats: true,
        notifySupplierRequests: true,
        notifyAiHandoffs: true,
        notifyAdminAlerts: true,
      },
    });

    if (!profile) {
      throw new BadRequestException(
        `Profile with id "${normalizedProfileId}" not found`,
      );
    }

    return profile;
  }

  private async getManagerCounters(profileId: string) {
    const managerScope = {
      OR: [
        { assignedManagerId: null },
        { assignedManagerId: profileId },
        { invitedManagerIds: { path: '$', array_contains: profileId } },
        { lastResolvedByManagerId: profileId },
      ],
    };

    const [unreadDialogs, aiDialogs, pendingSupplierRequests] =
      await Promise.all([
        this.prisma.message.findMany({
          where: {
            senderType: {
              in: ['client', 'supplier'],
            },
            status: {
              in: ['sent', 'delivered'],
            },
            ticket: {
              ...managerScope,
              aiEnabled: false,
              status: {
                notIn: ['resolved', 'closed'],
              },
            },
          },
          distinct: ['ticketId'],
          select: { ticketId: true },
        }),
        this.prisma.ticket.count({
          where: {
            ...managerScope,
            aiEnabled: true,
            status: {
              notIn: ['resolved', 'closed'],
            },
          },
        }),
        this.prisma.supplierRequest.count({
          where: {
            createdByManagerId: profileId,
            firstResponseAt: null,
            status: {
              notIn: ['closed', 'cancelled'],
            },
          },
        }),
      ]);

    return {
      unreadDialogs: unreadDialogs.length,
      aiDialogs,
      pendingSupplierRequests,
    };
  }

  private async getActiveManagerIds() {
    const statuses = await this.profilesService.getManagerStatuses();

    return statuses
      .filter((manager) => manager.managerStatus === 'online')
      .map((manager) => manager.id);
  }

  private async getActiveSupplierIds(supplierId?: string | null) {
    const statuses = await this.profilesService.getSupplierStatuses();
    const normalizedSupplierId = supplierId?.trim();

    return statuses
      .filter((supplier) => {
        if (supplier.supplierStatus !== 'online') {
          return false;
        }

        if (!normalizedSupplierId) {
          return true;
        }

        return (
          supplier.id === normalizedSupplierId ||
          supplier.supplierId === normalizedSupplierId
        );
      })
      .map((supplier) => supplier.id);
  }

  private shouldNotifyManagerAboutTicket(
    profileId: string,
    activeManagerIds: Set<string>,
    candidate: Pick<ManagerNotificationCandidate, 'assignedManagerId'>,
  ) {
    if (!activeManagerIds.has(profileId)) {
      return false;
    }

    if (!candidate.assignedManagerId) {
      return true;
    }

    return candidate.assignedManagerId === profileId;
  }

  private async createSystemMessageIfMissing(
    ticketId: string,
    content: string,
    createdAt: Date,
  ) {
    const existing = await this.prisma.message.findFirst({
      where: {
        ticketId,
        senderType: 'system',
        messageType: 'system',
        content,
      },
      select: { id: true },
    });

    if (existing) {
      return;
    }

    await this.prisma.message.create({
      data: {
        ticketId,
        content,
        senderType: 'system',
        senderRole: 'system',
        status: 'sent',
        deliveryStatus: 'sent',
        messageType: 'system',
        createdAt,
      },
    });
  }

  private async ensureManagerOperationalState() {
    const now = new Date();
    const missedThreshold = new Date(now.getTime() - 10 * 60 * 1000);
    const rescueThreshold = new Date(now.getTime() - 20 * 60 * 1000);

    const [unclaimedTickets, stalledAssignedTickets] = await Promise.all([
      this.prisma.ticket.findMany({
        where: {
          aiEnabled: false,
          assignedManagerId: null,
          status: {
            notIn: ['resolved', 'closed'],
          },
          claimRequiredAt: {
            lte: missedThreshold,
          },
          claimMissedAt: null,
        },
        select: {
          id: true,
        },
      }),
      this.prisma.ticket.findMany({
        where: {
          aiEnabled: false,
          assignedManagerId: {
            not: null,
          },
          status: {
            notIn: ['resolved', 'closed'],
          },
          lastClientMessageAt: {
            lte: rescueThreshold,
          },
          rescueQueuedAt: null,
        },
        select: {
          id: true,
          assignedManagerId: true,
          assignedManagerName: true,
          lastClientMessageAt: true,
          lastManagerReplyAt: true,
        },
      }),
    ]);

    for (const ticket of unclaimedTickets) {
      const claimMissedAt = new Date();
      const updateResult = await this.prisma.ticket.updateMany({
        where: {
          id: ticket.id,
          assignedManagerId: null,
          claimMissedAt: null,
        },
        data: {
          claimMissedAt,
        },
      });

      if (updateResult.count > 0) {
        await this.createSystemMessageIfMissing(
          ticket.id,
          'Пропущенное сообщение более 10 минут',
          claimMissedAt,
        );
      }
    }

    for (const ticket of stalledAssignedTickets) {
      if (
        ticket.lastManagerReplyAt &&
        ticket.lastClientMessageAt &&
        ticket.lastManagerReplyAt >= ticket.lastClientMessageAt
      ) {
        continue;
      }

      const rescueQueuedAt = new Date();
      const updateResult = await this.prisma.ticket.updateMany({
        where: {
          id: ticket.id,
          assignedManagerId: ticket.assignedManagerId,
          rescueQueuedAt: null,
        },
        data: {
          status: 'new',
          assignedManagerId: null,
          assignedManagerName: null,
          claimRequiredAt: ticket.lastClientMessageAt ?? rescueQueuedAt,
          returnedToQueueAt: rescueQueuedAt,
          rescueQueuedAt,
          handedToManagerAt: null,
        },
      });

      if (updateResult.count > 0) {
        await this.createSystemMessageIfMissing(
          ticket.id,
          ticket.assignedManagerName?.trim()
            ? `Чат возвращён в общую очередь: менеджер ${ticket.assignedManagerName} не ответил более 20 минут`
            : 'Чат возвращён в общую очередь: менеджер не ответил более 20 минут',
          rescueQueuedAt,
        );
      }
    }
  }

  private async ensureSupplierOperationalState() {
    const now = new Date();
    const missedThreshold = new Date(now.getTime() - 10 * 60 * 1000);
    const unclaimedRequests = await this.prisma.supplierRequest.findMany({
      where: {
        assignedSupplierProfileId: null,
        status: {
          notIn: ['closed', 'cancelled'],
        },
        claimRequiredAt: {
          lte: missedThreshold,
        },
        claimMissedAt: null,
      },
      select: {
        id: true,
        ticketId: true,
        supplierName: true,
      },
    });

    for (const request of unclaimedRequests) {
      const claimMissedAt = new Date();
      const updateResult = await this.prisma.supplierRequest.updateMany({
        where: {
          id: request.id,
          assignedSupplierProfileId: null,
          claimMissedAt: null,
        },
        data: {
          claimMissedAt,
        },
      });

      if (updateResult.count > 0) {
        await this.createSystemMessageIfMissing(
          request.ticketId,
          `Пропущенный запрос поставщику более 10 минут: ${request.supplierName}`,
          claimMissedAt,
        );
      }
    }
  }

  private async getSupplierCounters(profileId: string) {
    const profile = await this.ensureSettingsProfile(profileId, 'supplier');
    const supplierScopeId = profile.supplierId || profile.id;
    const [unreadDialogs, newRequests, openDialogs] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          senderType: 'manager',
          status: {
            in: ['sent', 'delivered'],
          },
          ticket: {
            OR: [
              { supplierId: supplierScopeId },
              {
                supplierRequests: {
                  some: {
                    supplierId: supplierScopeId,
                    OR: [
                      { assignedSupplierProfileId: null },
                      { assignedSupplierProfileId: profile.id },
                    ],
                  },
                },
              },
            ],
          },
        },
        distinct: ['ticketId'],
        select: { ticketId: true },
      }),
      this.prisma.supplierRequest.count({
        where: {
          supplierId: supplierScopeId,
          OR: [
            { assignedSupplierProfileId: null },
            { assignedSupplierProfileId: profile.id },
          ],
          firstResponseAt: null,
          status: {
            notIn: ['closed', 'cancelled'],
          },
        },
      }),
      this.prisma.ticket.count({
        where: {
          OR: [
            { supplierId: supplierScopeId },
            {
              supplierRequests: {
                some: {
                  supplierId: supplierScopeId,
                  OR: [
                    { assignedSupplierProfileId: null },
                    { assignedSupplierProfileId: profile.id },
                  ],
                },
              },
            },
          ],
          status: {
            notIn: ['resolved', 'closed'],
          },
        },
      }),
    ]);

    return {
      unreadDialogs: unreadDialogs.length,
      newRequests,
      openDialogs,
    };
  }

  private async getAdminCounters() {
    const [pendingRegistrations, slaBreaches, aiHandoffs] = await Promise.all([
      this.prisma.registrationRequest.count({
        where: {
          status: 'pending',
        },
      }),
      this.prisma.ticket.count({
        where: {
          slaBreached: true,
          status: {
            notIn: ['resolved', 'closed'],
          },
        },
      }),
      this.prisma.ticket.count({
        where: {
          handedToManagerAt: {
            not: null,
          },
          status: {
            notIn: ['resolved', 'closed'],
          },
        },
      }),
    ]);

    return {
      pendingRegistrations,
      slaBreaches,
      aiHandoffs,
    };
  }

  private async getCounters(profileId: string, role: string) {
    if (isManagerRole(role)) {
      return this.getManagerCounters(profileId);
    }

    if (isSupplierRole(role)) {
      return this.getSupplierCounters(profileId);
    }

    return this.getAdminCounters();
  }

  async getSettings(profileId: string, role: string) {
    const profile = await this.ensureSettingsProfile(profileId, role);
    const [devices, counters] = await Promise.all([
      this.prisma.pushSubscription.findMany({
        where: {
          profileId: profile.id,
        },
        orderBy: [
          { isActive: 'desc' },
          { lastUsedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        select: {
          id: true,
          endpoint: true,
          role: true,
          deviceLabel: true,
          userAgent: true,
          isActive: true,
          lastUsedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.getCounters(profile.id, profile.role),
    ]);

    return {
      profile: {
        id: profile.id,
        role: profile.role,
        fullName: profile.fullName,
        email: profile.email,
        chatAccessEnabled: profile.chatAccessEnabled,
      },
      preferences: {
        notificationPushEnabled: profile.notificationPushEnabled,
        notifyClientChats: profile.notifyClientChats,
        notifySupplierChats: profile.notifySupplierChats,
        notifySupplierRequests: profile.notifySupplierRequests,
        notifyAiHandoffs: profile.notifyAiHandoffs,
        notifyAdminAlerts: profile.notifyAdminAlerts,
      },
      counters,
      devices,
    };
  }

  async getManagerNotificationCandidates(profileId: string) {
    const profile = await this.ensureSettingsProfile(profileId, 'manager');
    await this.ensureManagerOperationalState();

    if (
      !profile.chatAccessEnabled ||
      !profile.notificationPushEnabled ||
      !profile.notifyClientChats
    ) {
      return {
        items: [],
      };
    }

    const [activeManagerIds, tickets] = await Promise.all([
      this.getActiveManagerIds(),
      this.prisma.ticket.findMany({
        where: {
          aiEnabled: false,
          status: {
            notIn: ['resolved', 'closed'],
          },
          messages: {
            some: {
              senderType: {
                in: ['client', 'supplier'],
              },
            },
          },
        },
        orderBy: {
          lastMessageAt: 'desc',
        },
        select: {
          id: true,
          title: true,
          status: true,
          clientName: true,
          tradePointName: true,
          supplierName: true,
          conversationMode: true,
          assignedManagerId: true,
          assignedManagerName: true,
          claimRequiredAt: true,
          claimedAt: true,
          claimMissedAt: true,
          rescueQueuedAt: true,
          lastClientMessageAt: true,
          lastManagerReplyAt: true,
          avatarColor: true,
          avatarEmoji: true,
          messages: {
            where: {
              senderType: {
                in: ['client', 'supplier'],
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
            take: 1,
            select: {
              id: true,
              content: true,
              senderType: true,
              status: true,
              createdAt: true,
            },
          },
          supplierRequests: {
            where: {
              status: {
                notIn: ['closed', 'cancelled', 'resolved'],
              },
            },
            orderBy: {
              createdAt: 'asc',
            },
            select: {
              id: true,
              status: true,
              createdAt: true,
              assignedSupplierProfileId: true,
              claimedAt: true,
              lastSupplierReplyAt: true,
              closedAt: true,
            },
          },
        },
      }),
    ]);

    const activeManagerIdsSet = new Set(activeManagerIds);
    const ticketIds = tickets.map((ticket) => ticket.id);
    const controlMessages =
      ticketIds.length === 0
        ? []
        : await this.prisma.message.findMany({
            where: {
              ticketId: {
                in: ticketIds,
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
    const controlMessagesByTicketId = controlMessages.reduce<
      Record<
        string,
        Array<{
          content: string;
          createdAt: Date;
          messageType: string | null;
        }>
      >
    >((accumulator, message) => {
      if (!accumulator[message.ticketId]) {
        accumulator[message.ticketId] = [];
      }

      accumulator[message.ticketId].push(message);
      return accumulator;
    }, {});

    const items = tickets
      .map((ticket) => {
        const latestUnreadMessage = ticket.messages[0];

        if (!latestUnreadMessage) {
          return null;
        }

        const isDirectSupplierDialog =
          ticket.conversationMode === 'direct_supplier';

        if (isDirectSupplierDialog && latestUnreadMessage.status === 'read') {
          return null;
        }

        if (
          !ticket.assignedManagerId &&
          latestUnreadMessage.senderType !== 'client'
        ) {
          return null;
        }

        const activeSupplierRequest = [...ticket.supplierRequests]
          .reverse()
          .find(
            (request) =>
              request.assignedSupplierProfileId &&
              !request.closedAt &&
              request.status !== 'closed' &&
              request.status !== 'cancelled' &&
              request.status !== 'resolved',
          );

        if (activeSupplierRequest) {
          const syncState = getSupplierRequestSyncState(
            ticket.supplierRequests,
            controlMessagesByTicketId[ticket.id] ?? [],
            activeSupplierRequest.id,
          );
          const supplierIsLive = !syncState.isPaused;
          const latestClientMessage =
            latestUnreadMessage.senderType === 'client'
              ? latestUnreadMessage
              : null;
          const supplierReplyAt =
            activeSupplierRequest.lastSupplierReplyAt?.getTime() ??
            activeSupplierRequest.claimedAt?.getTime() ??
            activeSupplierRequest.createdAt.getTime();
          const clientIsWaitingForSupplier =
            latestClientMessage &&
            latestClientMessage.createdAt.getTime() > supplierReplyAt;
          const clientWaitMs = latestClientMessage
            ? Date.now() - latestClientMessage.createdAt.getTime()
            : 0;

          if (
            supplierIsLive &&
            (!clientIsWaitingForSupplier ||
              clientWaitMs < MANAGER_SUPPLIER_CLIENT_ESCALATION_MS)
          ) {
            return null;
          }
        }

        const candidate: ManagerNotificationCandidate = {
          notificationKey: `ticket:${ticket.id}:${latestUnreadMessage.id}`,
          ticketId: ticket.id,
          title:
            (isDirectSupplierDialog
              ? ticket.supplierName?.trim()
              : ticket.title?.trim() || ticket.clientName?.trim()) || 'Клиент',
          clientName: isDirectSupplierDialog
            ? ticket.supplierName?.trim() || null
            : ticket.clientName?.trim() || null,
          tradePointName: isDirectSupplierDialog
            ? ticket.supplierName?.trim() || null
            : ticket.tradePointName?.trim() || null,
          messageId: latestUnreadMessage.id,
          messageText: latestUnreadMessage.content,
          createdAt: latestUnreadMessage.createdAt,
          avatarColor: ticket.avatarColor,
          avatarEmoji: ticket.avatarEmoji,
          conversationMode: ticket.conversationMode,
          scopeStatus: ticket.rescueQueuedAt
            ? 'rescue_queue'
            : ticket.claimMissedAt
              ? 'missed_unclaimed'
              : !ticket.assignedManagerId
                ? 'new_unclaimed'
                : 'owned_active',
          waitSeconds: Math.max(
            Math.floor(
              (Date.now() -
                (ticket.claimRequiredAt?.getTime() ??
                  latestUnreadMessage.createdAt.getTime())) /
                1000,
            ),
            0,
          ),
          assignedManagerId: ticket.assignedManagerId,
          assignedManagerName: ticket.assignedManagerName,
        };

        if (!activeManagerIdsSet.has(profile.id)) {
          return null;
        }

        if (!ticket.assignedManagerId) {
          return candidate;
        }

        if (ticket.status === 'waiting_supplier') {
          return null;
        }

        if (
          ticket.assignedManagerId === profile.id &&
          (!ticket.lastManagerReplyAt ||
            latestUnreadMessage.createdAt > ticket.lastManagerReplyAt)
        ) {
          return {
            ...candidate,
            scopeStatus: 'owned_active',
            waitSeconds: Math.max(
              Math.floor(
                (Date.now() - latestUnreadMessage.createdAt.getTime()) / 1000,
              ),
              0,
            ),
          };
        }

        return null;
      })
      .filter((candidate): candidate is ManagerNotificationCandidate =>
        Boolean(candidate),
      );

    const recentlyClaimedByOther = tickets
      .filter(
        (ticket) =>
          ticket.assignedManagerId &&
          ticket.assignedManagerId !== profile.id &&
          ticket.claimedAt &&
          Date.now() - ticket.claimedAt.getTime() <= 45_000,
      )
      .map((ticket) => {
        const latestUnreadMessage = ticket.messages[0];
        const createdAt =
          ticket.claimedAt ?? latestUnreadMessage?.createdAt ?? new Date();
        const isDirectSupplierDialog =
          ticket.conversationMode === 'direct_supplier';

        return {
          notificationKey: `ticket-claimed:${ticket.id}:${createdAt.toISOString()}`,
          ticketId: ticket.id,
          title:
            (isDirectSupplierDialog
              ? ticket.supplierName?.trim()
              : ticket.title?.trim() || ticket.clientName?.trim()) || 'Клиент',
          clientName: isDirectSupplierDialog
            ? ticket.supplierName?.trim() || null
            : ticket.clientName?.trim() || null,
          tradePointName: isDirectSupplierDialog
            ? ticket.supplierName?.trim() || null
            : ticket.tradePointName?.trim() || null,
          messageId: latestUnreadMessage?.id ?? `claimed:${ticket.id}`,
          messageText: latestUnreadMessage?.content ?? 'Чат уже взят в работу',
          createdAt,
          avatarColor: ticket.avatarColor,
          avatarEmoji: ticket.avatarEmoji,
          conversationMode: ticket.conversationMode,
          scopeStatus: 'claimed_by_other_recently' as const,
          waitSeconds: 0,
          assignedManagerId: ticket.assignedManagerId,
          assignedManagerName: ticket.assignedManagerName,
        };
      });

    return {
      items: [...items, ...recentlyClaimedByOther].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      ),
    };
  }

  async getSupplierNotificationCandidates(
    profileId: string,
    supplierId?: string,
  ) {
    const profile = await this.ensureSettingsProfile(profileId, 'supplier');
    await this.ensureSupplierOperationalState();
    const normalizedSupplierScopeId =
      supplierId?.trim() || profile.supplierId?.trim() || profile.id;

    if (
      !profile.chatAccessEnabled ||
      (!profile.notifySupplierChats && !profile.notifySupplierRequests)
    ) {
      return {
        items: [],
      };
    }

    const activeSupplierIds = new Set(
      await this.getActiveSupplierIds(normalizedSupplierScopeId),
    );

    if (!activeSupplierIds.has(profile.id)) {
      return {
        items: [],
      };
    }

    const items: SupplierNotificationCandidate[] = [];
    const requests = await this.prisma.supplierRequest.findMany({
      where: {
        supplierId: normalizedSupplierScopeId,
        status: {
          notIn: ['closed', 'cancelled', 'resolved'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        ticketId: true,
        supplierId: true,
        supplierName: true,
        requestText: true,
        status: true,
        createdAt: true,
        claimRequiredAt: true,
        claimMissedAt: true,
        claimedAt: true,
        assignedSupplierProfileId: true,
        assignedSupplierProfileName: true,
        lastManagerMessageAt: true,
        lastSupplierReplyAt: true,
        respondedAt: true,
        closedAt: true,
        ticket: {
          select: {
            status: true,
            tradePointName: true,
            title: true,
            clientName: true,
            avatarColor: true,
            avatarEmoji: true,
            supplierId: true,
            supplierName: true,
          },
        },
      },
    });

    const ticketIds = [...new Set(requests.map((request) => request.ticketId))];
    const [rawControlMessages, rawChatMessages] = await Promise.all([
      ticketIds.length === 0
        ? Promise.resolve([])
        : this.prisma.message.findMany({
            where: {
              ticketId: {
                in: ticketIds,
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
          }),
      ticketIds.length === 0
        ? Promise.resolve([])
        : this.prisma.message.findMany({
            where: {
              ticketId: {
                in: ticketIds,
              },
              senderType: {
                in: ['manager', 'client', 'supplier'],
              },
            },
            select: {
              id: true,
              ticketId: true,
              content: true,
              createdAt: true,
              senderType: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          }),
    ]);

    const controlMessages = rawControlMessages as Array<{
      ticketId: string;
      content: string;
      createdAt: Date;
      messageType: string | null;
    }>;
    const chatMessages = rawChatMessages as Array<{
      id: string;
      ticketId: string;
      content: string;
      createdAt: Date;
      senderType: string;
    }>;

    const requestsByTicketId = requests.reduce<
      Record<string, SupplierNotificationRequestRecord[]>
    >((accumulator, request) => {
      if (!accumulator[request.ticketId]) {
        accumulator[request.ticketId] = [];
      }

      accumulator[request.ticketId].push(request);
      return accumulator;
    }, {});

    const controlMessagesByTicketId: Record<
      string,
      Array<{
        content: string;
        createdAt: Date;
        messageType: string | null;
      }>
    > = controlMessages.reduce<
      Record<
        string,
        Array<{
          content: string;
          createdAt: Date;
          messageType: string | null;
        }>
      >
    >((accumulator, message) => {
      if (!accumulator[message.ticketId]) {
        accumulator[message.ticketId] = [];
      }

      accumulator[message.ticketId].push(message);
      return accumulator;
    }, {});

    const chatMessagesByTicketId: Record<
      string,
      Array<{
        id: string;
        content: string;
        createdAt: Date;
        senderType: 'manager' | 'client' | 'supplier';
      }>
    > = chatMessages.reduce<
      Record<
        string,
        Array<{
          id: string;
          content: string;
          createdAt: Date;
          senderType: 'manager' | 'client' | 'supplier';
        }>
      >
    >((accumulator, message) => {
      if (!accumulator[message.ticketId]) {
        accumulator[message.ticketId] = [];
      }

      accumulator[message.ticketId].push({
        ...message,
        senderType:
          message.senderType === 'client'
            ? 'client'
            : message.senderType === 'supplier'
              ? 'supplier'
              : 'manager',
      });
      return accumulator;
    }, {});

    const repairOperations: Array<Promise<unknown>> = [];

    requests.forEach((request) => {
      const ticket = request.ticket;

      if (
        !ticket ||
        ticket.status === 'resolved' ||
        ticket.status === 'closed'
      ) {
        return;
      }

      const ticketRequests = [
        ...(requestsByTicketId[request.ticketId] ?? []),
      ].sort(
        (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
      );
      const requestIndex = ticketRequests.findIndex(
        (ticketRequest) => ticketRequest.id === request.id,
      );

      if (requestIndex < 0) {
        return;
      }

      const syncState = getSupplierRequestSyncState(
        ticketRequests,
        controlMessagesByTicketId[request.ticketId] ?? [],
        request.id,
      );

      if (syncState.isPaused) {
        return;
      }

      if (
        request.assignedSupplierProfileId &&
        request.assignedSupplierProfileId !== profile.id
      ) {
        return;
      }

      const title =
        ticket.tradePointName?.trim() ||
        ticket.title?.trim() ||
        ticket.clientName?.trim() ||
        request.supplierName?.trim() ||
        'Диалог с клиентом';

      if (!request.assignedSupplierProfileId) {
        if (!profile.notifySupplierRequests) {
          return;
        }

        items.push({
          notificationKey: `supplier-request:${request.id}`,
          ticketId: request.ticketId,
          requestId: request.id,
          title,
          messageId: `request:${request.id}`,
          messageText: request.requestText,
          createdAt: request.createdAt,
          tradePointName: ticket.tradePointName?.trim() || null,
          avatarColor: ticket.avatarColor,
          avatarEmoji: ticket.avatarEmoji,
          scopeStatus: request.claimMissedAt
            ? 'missed_unclaimed'
            : 'new_unclaimed',
          waitSeconds: Math.max(
            Math.floor(
              (Date.now() -
                (request.claimRequiredAt?.getTime() ??
                  request.createdAt.getTime())) /
                1000,
            ),
            0,
          ),
          assignedSupplierProfileId: null,
          assignedSupplierProfileName: null,
          kind: 'request',
        });
        return;
      }

      if (!profile.notifySupplierChats) {
        return;
      }

      const nextRequestStartedAt =
        requestIndex < ticketRequests.length - 1
          ? ticketRequests[requestIndex + 1].createdAt.getTime()
          : Number.POSITIVE_INFINITY;
      const requestWindowMessages = (
        chatMessagesByTicketId[request.ticketId] ?? []
      ).filter((message) => {
        const createdAtMs = message.createdAt.getTime();

        return (
          createdAtMs >= request.createdAt.getTime() &&
          createdAtMs < nextRequestStartedAt
        );
      });
      const latestSupplierMessage =
        requestWindowMessages
          .filter((message) => message.senderType === 'supplier')
          .at(-1) ?? null;
      const latestManagerMessage =
        requestWindowMessages
          .filter((message) => message.senderType === 'manager')
          .at(-1) ?? null;
      const baselineAt = Math.max(
        request.claimedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
        latestSupplierMessage?.createdAt.getTime() ??
          request.lastSupplierReplyAt?.getTime() ??
          Number.NEGATIVE_INFINITY,
        syncState.lastResumedAt
          ? new Date(syncState.lastResumedAt).getTime()
          : Number.NEGATIVE_INFINITY,
        request.createdAt.getTime(),
      );
      const latestIncomingMessage =
        requestWindowMessages
          .filter(
            (
              message,
            ): message is typeof message & {
              senderType: 'manager' | 'client';
            } => message.senderType !== 'supplier',
          )
          .at(-1) ?? null;

      if (request.assignedSupplierProfileId === profile.id) {
        const repairedSupplierReplyAt =
          latestSupplierMessage?.createdAt ?? null;
        const repairedManagerMessageAt =
          latestManagerMessage?.createdAt ?? null;
        const needsSupplierReplyRepair =
          repairedSupplierReplyAt &&
          repairedSupplierReplyAt.getTime() >
            (request.lastSupplierReplyAt?.getTime() ??
              Number.NEGATIVE_INFINITY);
        const needsManagerMessageRepair =
          repairedManagerMessageAt &&
          repairedManagerMessageAt.getTime() >
            (request.lastManagerMessageAt?.getTime() ??
              Number.NEGATIVE_INFINITY);
        const normalizedRequestSupplierId =
          request.supplierId?.trim() || normalizedSupplierScopeId;
        const normalizedTicketSupplierId =
          request.ticket?.supplierId?.trim() || null;
        const needsTicketScopeRepair =
          normalizedRequestSupplierId &&
          normalizedTicketSupplierId !== normalizedRequestSupplierId;

        if (
          needsSupplierReplyRepair ||
          needsManagerMessageRepair ||
          needsTicketScopeRepair
        ) {
          repairOperations.push(
            (async () => {
              if (needsSupplierReplyRepair || needsManagerMessageRepair) {
                await this.prisma.supplierRequest.update({
                  where: { id: request.id },
                  data: {
                    ...(needsSupplierReplyRepair
                      ? {
                          lastSupplierReplyAt: repairedSupplierReplyAt,
                          respondedAt:
                            repairedSupplierReplyAt &&
                            (!request.respondedAt ||
                              repairedSupplierReplyAt.getTime() >
                                request.respondedAt.getTime())
                              ? repairedSupplierReplyAt
                              : undefined,
                        }
                      : {}),
                    ...(needsManagerMessageRepair
                      ? {
                          lastManagerMessageAt: repairedManagerMessageAt,
                        }
                      : {}),
                  },
                });
              }

              if (needsTicketScopeRepair) {
                await this.prisma.ticket.updateMany({
                  where: {
                    id: request.ticketId,
                    OR: [
                      { supplierId: null },
                      { supplierId: normalizedTicketSupplierId ?? undefined },
                    ],
                  },
                  data: {
                    supplierId: normalizedRequestSupplierId,
                    supplierName:
                      request.supplierName?.trim() ||
                      request.ticket?.supplierName?.trim() ||
                      undefined,
                  },
                });
              }
            })(),
          );
        }
      }

      if (
        !latestIncomingMessage ||
        latestIncomingMessage.createdAt.getTime() <= baselineAt
      ) {
        return;
      }

      items.push({
        notificationKey: `supplier-message:${request.ticketId}:${latestIncomingMessage.id}`,
        ticketId: request.ticketId,
        requestId: request.id,
        title,
        messageId: latestIncomingMessage.id,
        messageText: latestIncomingMessage.content,
        createdAt: latestIncomingMessage.createdAt,
        senderType: latestIncomingMessage.senderType,
        tradePointName: ticket.tradePointName?.trim() || null,
        avatarColor: ticket.avatarColor,
        avatarEmoji: ticket.avatarEmoji,
        scopeStatus: 'owned_active',
        waitSeconds: Math.max(
          Math.floor(
            (Date.now() - latestIncomingMessage.createdAt.getTime()) / 1000,
          ),
          0,
        ),
        assignedSupplierProfileId: request.assignedSupplierProfileId,
        assignedSupplierProfileName: request.assignedSupplierProfileName,
        kind: 'message',
      });
    });

    const recentlyClaimedByOther = await this.prisma.supplierRequest.findMany({
      where: {
        supplierId: normalizedSupplierScopeId,
        assignedSupplierProfileId: {
          not: null,
        },
        NOT: {
          assignedSupplierProfileId: profile.id,
        },
        claimedAt: {
          gte: new Date(Date.now() - 45_000),
        },
        status: {
          notIn: ['closed', 'cancelled', 'resolved'],
        },
      },
      select: {
        id: true,
        ticketId: true,
        supplierName: true,
        requestText: true,
        claimedAt: true,
        assignedSupplierProfileId: true,
        assignedSupplierProfileName: true,
        ticket: {
          select: {
            tradePointName: true,
            title: true,
            clientName: true,
            avatarColor: true,
            avatarEmoji: true,
          },
        },
      },
      orderBy: {
        claimedAt: 'desc',
      },
      take: 5,
    });

    recentlyClaimedByOther.forEach((request) => {
      if (!request.claimedAt) {
        return;
      }

      items.push({
        notificationKey: `supplier-claimed:${request.id}:${request.claimedAt.toISOString()}`,
        ticketId: request.ticketId,
        requestId: request.id,
        title:
          request.ticket?.tradePointName?.trim() ||
          request.ticket?.title?.trim() ||
          request.ticket?.clientName?.trim() ||
          request.supplierName?.trim() ||
          'Запрос поставщику',
        messageId: `claimed:${request.id}`,
        messageText: request.requestText,
        createdAt: request.claimedAt,
        tradePointName: request.ticket?.tradePointName?.trim() || null,
        avatarColor: request.ticket?.avatarColor,
        avatarEmoji: request.ticket?.avatarEmoji,
        scopeStatus: 'claimed_by_other_recently',
        waitSeconds: 0,
        assignedSupplierProfileId: request.assignedSupplierProfileId,
        assignedSupplierProfileName: request.assignedSupplierProfileName,
        kind: 'request',
      });
    });

    items.sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );

    if (repairOperations.length > 0) {
      await Promise.allSettled(repairOperations);
    }

    return {
      items,
    };
  }

  async updatePreferences(
    profileId: string,
    role: string,
    input: NotificationPreferencesInput,
  ) {
    await this.ensureSettingsProfile(profileId, role);

    const updated = await this.prisma.profile.update({
      where: { id: profileId },
      data: {
        notificationPushEnabled: input.notificationPushEnabled ?? undefined,
        notifyClientChats: input.notifyClientChats ?? undefined,
        notifySupplierChats: input.notifySupplierChats ?? undefined,
        notifySupplierRequests: input.notifySupplierRequests ?? undefined,
        notifyAiHandoffs: input.notifyAiHandoffs ?? undefined,
        notifyAdminAlerts: input.notifyAdminAlerts ?? undefined,
      },
      select: {
        notificationPushEnabled: true,
        notifyClientChats: true,
        notifySupplierChats: true,
        notifySupplierRequests: true,
        notifyAiHandoffs: true,
        notifyAdminAlerts: true,
      },
    });

    return {
      ok: true,
      preferences: updated,
    };
  }

  async deactivateDevice(profileId: string, subscriptionId: string) {
    const subscription = await this.prisma.pushSubscription.findFirst({
      where: {
        id: subscriptionId,
        profileId,
      },
      select: {
        id: true,
      },
    });

    if (!subscription) {
      throw new BadRequestException('Устройство не найдено');
    }

    await this.prisma.pushSubscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        isActive: false,
      },
    });

    return {
      ok: true,
    };
  }
}
