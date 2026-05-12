import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthService } from '../auth.service';
import { ProfilesService } from '../profiles.service';
import { PrismaService } from '../prisma.service';
import { readJsonStringArray } from '../prisma-json.util';
import { isManagerRole, isSupplierRole } from '../role.utils';

type DateRangeInput = {
  preset?: string;
  dateFrom?: string;
  dateTo?: string;
  companyName?: string;
};

type RegistrationsFilter = {
  role?: string;
  status?: string;
};

type UsersFilter = {
  role?: string;
  status?: string;
  company?: string;
  dateFrom?: string;
  dateTo?: string;
};

type DialogsFilter = {
  status?: string;
  managerId?: string;
  supplierId?: string;
  preset?: string;
  dateFrom?: string;
  dateTo?: string;
  supplierEscalated?: string;
  slaBreached?: string;
};

type InsightBucket = {
  label: string;
  count: number;
};

type InsightTicketWithMessages = {
  id: string;
  title: string;
  createdAt: Date;
  topicCategory: string | null;
  aiActivatedAt?: Date | null;
  aiDeactivatedAt?: Date | null;
  handedToManagerAt?: Date | null;
  aiResolved?: boolean;
  messages?: Array<{ content: string; senderType?: string }>;
};

type AdminActorContext = {
  adminId: string;
  adminName?: string;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesService: ProfilesService,
    private readonly authService: AuthService,
  ) {}

  private toDate(value?: string | null, fallback?: Date | null) {
    if (!value) {
      return fallback ?? null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? (fallback ?? null) : parsed;
  }

  private normalizeDateRange(input?: DateRangeInput) {
    const now = new Date();
    const explicitFrom = this.toDate(input?.dateFrom);
    const explicitTo = this.toDate(input?.dateTo);

    if (explicitFrom || explicitTo) {
      const to = explicitTo ?? now;

      if (input?.dateTo && !input.dateTo.includes('T')) {
        to.setHours(23, 59, 59, 999);
      }

      return {
        from:
          explicitFrom ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        to,
      };
    }

    const preset = input?.preset ?? 'week';

    if (preset === 'today' || preset === 'day') {
      const from = new Date(now);
      from.setHours(0, 0, 0, 0);

      return { from, to: now };
    }

    if (preset === 'yesterday') {
      const from = new Date(now);
      from.setDate(from.getDate() - 1);
      from.setHours(0, 0, 0, 0);

      const to = new Date(from);
      to.setHours(23, 59, 59, 999);

      return { from, to };
    }

    const durationByPreset: Record<string, number> = {
      week: 7,
      month: 30,
    };
    const days = durationByPreset[preset] ?? 7;

    return {
      from: new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000),
      to: now,
    };
  }

  private formatDayKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private toBooleanFlag(value?: string) {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    return undefined;
  }

  private readonly manageableRoles = [
    'admin',
    'manager',
    'manager_supervisor',
    'supplier',
    'supplier_supervisor',
    'client',
  ] as const;

  private readonly adminUsersVisibleRoles = [
    'admin',
    'manager',
    'manager_supervisor',
    'supplier',
    'supplier_supervisor',
  ] as const;

  private sanitizeLoginCandidate(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9@._-]+/g, '.')
      .replace(/\.+/g, '.')
      .replace(/^\.|\.$/g, '');
  }

  private normalizeEmail(value?: string | null) {
    const normalizedValue = value?.trim().toLowerCase() || '';

    if (!normalizedValue) {
      return null;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(normalizedValue)) {
      throw new BadRequestException('Некорректный email');
    }

    return normalizedValue;
  }

  private normalizeRole(value?: string | null) {
    const role = value?.trim();

    if (!role || !this.manageableRoles.includes(role as (typeof this.manageableRoles)[number])) {
      throw new BadRequestException('Недопустимая роль пользователя');
    }

    return role;
  }

  private normalizeCompanyName(value?: string | null) {
    const normalizedValue = value?.trim() || null;
    return normalizedValue;
  }

  private buildSupplierScopeId(companyName: string) {
    const normalizedCompany = companyName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_+/g, '_');

    return `supplier_scope_${normalizedCompany || 'default'}`;
  }

  private getSupplierProfileScope(profile: {
    id: string;
    supplierId?: string | null;
    companyName?: string | null;
  }) {
    const companyName = this.normalizeCompanyName(profile.companyName);
    return (
      profile.supplierId?.trim() ||
      (companyName ? this.buildSupplierScopeId(companyName) : profile.id)
    );
  }

  private isSyntheticSupplierScope(profile: {
    id: string;
    companyName?: string | null;
  }) {
    return profile.id.startsWith('supplier_scope_') && !profile.companyName?.trim();
  }

  private supplierRequestBelongsToProfile(
    request: {
      supplierId?: string | null;
      assignedSupplierProfileId?: string | null;
      ticket?: {
        messages?: Array<{
          senderType: string;
          senderProfileId?: string | null;
        }>;
      } | null;
    },
    profile: {
      id: string;
      supplierId?: string | null;
      companyName?: string | null;
    },
  ) {
    if (request.assignedSupplierProfileId) {
      return request.assignedSupplierProfileId === profile.id;
    }

    if (request.supplierId === profile.id) {
      return true;
    }

    const scopeId = this.getSupplierProfileScope(profile);

    if (request.supplierId !== scopeId) {
      return false;
    }

    return Boolean(
      request.ticket?.messages?.some(
        (message) =>
          message.senderType === 'supplier' &&
          message.senderProfileId === profile.id,
      ),
    );
  }

  private async ensureUniqueProfileFields(input: {
    email?: string | null;
    authLogin?: string | null;
    excludedProfileId?: string;
  }) {
    if (input.email) {
      const emailOwner = await this.prisma.profile.findFirst({
        where: {
          email: input.email,
          ...(input.excludedProfileId
            ? {
                id: {
                  not: input.excludedProfileId,
                },
              }
            : {}),
        },
        select: { id: true },
      });

      if (emailOwner) {
        throw new BadRequestException('Этот email уже используется');
      }
    }

    if (input.authLogin) {
      const loginOwner = await this.prisma.profile.findFirst({
        where: {
          authLogin: input.authLogin,
          ...(input.excludedProfileId
            ? {
                id: {
                  not: input.excludedProfileId,
                },
              }
            : {}),
        },
        select: { id: true },
      });

      if (loginOwner) {
        throw new BadRequestException('Этот логин уже используется');
      }
    }
  }

  private async resolveSupplierSupervisorByCompany(
    companyName: string,
    excludedProfileId?: string,
  ) {
    const supervisors = await this.prisma.profile.findMany({
      where: {
        role: 'supplier_supervisor',
        companyName,
        isActive: true,
        approvalStatus: {
          not: 'rejected',
        },
        ...(excludedProfileId
          ? {
              id: {
                not: excludedProfileId,
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        fullName: true,
        supplierId: true,
      },
    });

    if (supervisors.length > 1) {
      throw new BadRequestException(
        `Для компании "${companyName}" найдено несколько управленцев поставщика. Оставьте одного активного управленца.`,
      );
    }

    return supervisors[0] ?? null;
  }

  private async backfillSuppliersForSupervisor(
    supervisorProfileId: string,
    companyName: string,
    supplierScopeId: string,
  ) {
    await this.prisma.profile.updateMany({
      where: {
        role: 'supplier',
        companyName,
      },
      data: {
        supplierId: supplierScopeId,
        supervisorProfileId,
      },
    });
  }

  private average(values: Array<number | null | undefined>) {
    const normalized = values.filter(
      (value): value is number => typeof value === 'number',
    );

    if (normalized.length === 0) {
      return null;
    }

    return Math.round(
      normalized.reduce((total, value) => total + value, 0) / normalized.length,
    );
  }

  private async logAdminEvent(input: {
    type: string;
    title: string;
    description?: string | null;
    actor?: AdminActorContext;
    targetProfileId?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    await this.prisma.adminEvent.create({
      data: {
        type: input.type,
        title: input.title,
        description: input.description ?? null,
        actorProfileId: input.actor?.adminId?.trim() || null,
        targetProfileId: input.targetProfileId?.trim() || null,
        metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
  }

  private resolveManagerPresenceStatus(
    managerStatus?: string | null,
    _heartbeatAt?: Date | null,
  ) {
    if (!managerStatus || managerStatus === 'offline') {
      return 'offline';
    }

    return managerStatus;
  }

  private buildTopicBuckets(
    tickets: Array<{ title: string; topicCategory: string | null }>,
  ) {
    const buckets = new Map<string, number>();

    for (const ticket of tickets) {
      const rawTopic = ticket.topicCategory?.trim() || ticket.title.trim();
      const normalizedTopic = rawTopic
        ? rawTopic.split(/[-,:]/)[0].trim()
        : 'Без категории';
      buckets.set(normalizedTopic, (buckets.get(normalizedTopic) ?? 0) + 1);
    }

    return [...buckets.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 5);
  }

  private buildTimeSeries(
    tickets: Array<{ createdAt: Date }>,
    from: Date,
    to: Date,
  ) {
    const buckets = new Map<string, number>();
    const cursor = new Date(from);

    while (cursor <= to) {
      buckets.set(this.formatDayKey(cursor), 0);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    for (const ticket of tickets) {
      const key = this.formatDayKey(ticket.createdAt);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    return [...buckets.entries()].map(([date, count]) => ({ date, count }));
  }

  private buildStatusLabel(status: string | null | undefined) {
    const labels: Record<string, string> = {
      new: 'Новый',
      in_progress: 'В работе',
      waiting_client: 'Ожидает клиента',
      waiting_supplier: 'Ожидает поставщика',
      resolved: 'Решён',
      closed: 'Закрыт',
      pending: 'На проверке',
      approved: 'Подтверждён',
      rejected: 'Отклонён',
      active: 'Активен',
      inactive: 'Неактивен',
      blocked: 'Заблокирован',
      pending_approval: 'Ждёт одобрения',
    };

    return labels[status ?? ''] ?? status ?? 'Не указан';
  }

  private buildHourDistribution(
    tickets: Array<{ createdAt: Date }>,
  ): InsightBucket[] {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      label: `${String(hour).padStart(2, '0')}:00`,
      count: 0,
    }));

    for (const ticket of tickets) {
      const hour = ticket.createdAt.getHours();
      buckets[hour].count += 1;
    }

    return buckets;
  }

  private buildWeekdayDistribution(
    tickets: Array<{ createdAt: Date }>,
  ): InsightBucket[] {
    const labels = [
      'Воскресенье',
      'Понедельник',
      'Вторник',
      'Среда',
      'Четверг',
      'Пятница',
      'Суббота',
    ];
    const buckets = labels.map((label) => ({ label, count: 0 }));

    for (const ticket of tickets) {
      buckets[ticket.createdAt.getDay()].count += 1;
    }

    return buckets;
  }

  private buildKeywordInsights(tickets: InsightTicketWithMessages[]) {
    const triggerRules = [
      {
        label: 'Сроки и доставка',
        patterns: ['срок', 'достав', 'когда', 'задерж', 'ожидан'],
      },
      {
        label: 'Ламинат',
        patterns: ['ламинат', 'ламината', 'ламинату'],
      },
      {
        label: 'Наличие товара',
        patterns: ['налич', 'есть ли', 'остат', 'в наличии'],
      },
      {
        label: 'Цена и скидки',
        patterns: ['цен', 'стоим', 'скид', 'дешев'],
      },
      {
        label: 'Рекламации и брак',
        patterns: ['брак', 'рекламац', 'поврежд', 'царап', 'дефект'],
      },
      {
        label: 'Монтаж и укладка',
        patterns: ['уклад', 'монтаж', 'установ', 'подложк'],
      },
    ];

    return triggerRules
      .map((rule) => {
        const count = tickets.filter((ticket) => {
          const corpus = [
            ticket.topicCategory ?? '',
            ticket.title,
            ...(ticket.messages ?? []).map((message) => message.content),
          ]
            .join(' ')
            .toLowerCase();

          return rule.patterns.some((pattern) => corpus.includes(pattern));
        }).length;

        return {
          label: rule.label,
          count,
        };
      })
      .filter((item) => item.count > 0)
      .sort((left, right) => right.count - left.count)
      .slice(0, 6);
  }

  private buildAiRequestInsights(tickets: InsightTicketWithMessages[]) {
    const aiTickets = tickets.filter(
      (ticket) =>
        Boolean(ticket.aiActivatedAt) ||
        Boolean(ticket.aiResolved) ||
        Boolean(ticket.handedToManagerAt) ||
        (ticket.messages ?? []).some((message) => message.senderType === 'ai'),
    );

    const aiTopics = this.buildTopicBuckets(aiTickets);
    const aiTriggers = this.buildKeywordInsights(
      aiTickets.map((ticket) => ({
        ...ticket,
        messages: (ticket.messages ?? []).filter(
          (message) => message.senderType === 'client',
        ),
      })),
    );

    return {
      aiTickets,
      aiTopics,
      aiTriggers,
    };
  }

  private buildDialogsWhere(filters: DialogsFilter) {
    const supplierEscalated = this.toBooleanFlag(filters.supplierEscalated);
    const slaBreached = this.toBooleanFlag(filters.slaBreached);
    const range =
      filters.preset || filters.dateFrom || filters.dateTo
        ? this.normalizeDateRange(filters)
        : null;

    return {
      conversationMode: {
        not: 'direct_supplier',
      },
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.managerId ? { assignedManagerId: filters.managerId } : {}),
      ...(filters.supplierId
        ? {
            OR: [
              { supplierId: filters.supplierId },
              {
                supplierRequests: {
                  some: {
                    supplierId: filters.supplierId,
                  },
                },
              },
            ],
          }
        : {}),
      ...(range
        ? {
            createdAt: {
              gte: range.from,
              lte: range.to,
            },
          }
        : {}),
      ...(supplierEscalated === undefined
        ? {}
        : supplierEscalated
          ? { supplierEscalatedAt: { not: null } }
          : { supplierEscalatedAt: null }),
      ...(slaBreached === undefined
        ? {}
        : slaBreached
          ? {
              OR: [
                { slaBreached: true },
                { firstResponseBreached: true },
                {
                  supplierRequests: {
                    some: {
                      responseBreached: true,
                    },
                  },
                },
              ],
            }
          : {
              slaBreached: false,
              firstResponseBreached: false,
              supplierRequests: {
                none: {
                  responseBreached: true,
                },
              },
            }),
    };
  }

  private buildClientDialogWhere(dialog: {
    id: string;
    clientId?: string | null;
    clientEmail?: string | null;
    canonicalEmail?: string | null;
    currentUserEmail?: string | null;
    tradePointExternalId?: string | null;
    tradePointName?: string | null;
    clientName?: string | null;
  }): Prisma.TicketWhereInput {
    const or: Prisma.TicketWhereInput[] = [{ id: dialog.id }];
    const clientId = dialog.clientId?.trim();
    const email =
      dialog.canonicalEmail?.trim()?.toLowerCase() ||
      dialog.clientEmail?.trim()?.toLowerCase() ||
      dialog.currentUserEmail?.trim()?.toLowerCase();
    const tradePointExternalId = dialog.tradePointExternalId?.trim();
    const tradePointName = dialog.tradePointName?.trim();
    const clientName = dialog.clientName?.trim();

    if (clientId) {
      or.push({ clientId });
    }

    if (email) {
      or.push({ canonicalEmail: email }, { clientEmail: email }, { currentUserEmail: email });
    }

    if (tradePointExternalId) {
      or.push({ tradePointExternalId });
    }

    if (tradePointName) {
      or.push({ tradePointName });
    }

    if (clientName) {
      or.push({ clientName });
    }

    return { OR: or };
  }

  async getOverview(input?: DateRangeInput) {
    const [
      tickets,
      supplierRequests,
      profiles,
      claimMessages,
      registrationsPending,
      recentRegistrations,
      recentSystemMessages,
      recentAdminEvents,
      emailMessagesCount,
      pushSubscriptionsCount,
    ] = await Promise.all([
      this.prisma.ticket.findMany({
        select: {
          id: true,
          title: true,
          status: true,
          firstResponseTime: true,
          firstResponseBreached: true,
          lastMessageAt: true,
          createdAt: true,
          assignedManagerId: true,
          assignedManagerName: true,
          assignedManagerProfile: {
            select: {
              fullName: true,
            },
          },
          supplierId: true,
          supplierName: true,
          supplierProfile: {
            select: {
              fullName: true,
              companyName: true,
            },
          },
          clientId: true,
          clientEmail: true,
          tradePointExternalId: true,
          tradePointName: true,
          requestCount: true,
          topicCategory: true,
          supplierEscalatedAt: true,
          slaBreached: true,
        },
        orderBy: [{ createdAt: 'asc' }],
      }),
      this.prisma.supplierRequest.findMany({
        select: {
          id: true,
          ticketId: true,
          supplierName: true,
          status: true,
          requestedAt: true,
          firstResponseAt: true,
          claimedAt: true,
          responseTime: true,
          responseBreached: true,
          supplierId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.profile.findMany({
        where: {
          role: {
            in: ['manager', 'supplier'],
          },
          isActive: true,
          status: {
            not: 'blocked',
          },
        },
        select: {
          id: true,
          role: true,
          fullName: true,
          managerStatus: true,
          managerPresenceHeartbeatAt: true,
          lastLoginAt: true,
        },
      }),
      this.prisma.message.findMany({
        where: {
          senderType: 'system',
          messageType: 'system',
          content: {
            contains: 'Диалог взят в работу менеджером',
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 8,
        select: {
          id: true,
          content: true,
          createdAt: true,
          ticketId: true,
          ticket: {
            select: {
              title: true,
              assignedManagerId: true,
              assignedManagerName: true,
            },
          },
        },
      }),
      this.prisma.registrationRequest.count({
        where: {
          status: 'pending',
        },
      }),
      this.prisma.registrationRequest.findMany({
        orderBy: [{ updatedAt: 'desc' }],
        take: 8,
        select: {
          id: true,
          fullName: true,
          role: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
        },
      }),
      this.prisma.message.findMany({
        where: {
          senderType: 'system',
          messageType: 'system',
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 10,
        select: {
          id: true,
          content: true,
          createdAt: true,
          ticketId: true,
          ticket: {
            select: {
              title: true,
            },
          },
        },
      }),
      this.prisma.adminEvent.findMany({
        orderBy: [{ createdAt: 'desc' }],
        take: 10,
        select: {
          id: true,
          type: true,
          title: true,
          description: true,
          createdAt: true,
          actorProfile: {
            select: {
              fullName: true,
            },
          },
          targetProfile: {
            select: {
              fullName: true,
            },
          },
        },
      }),
      this.prisma.message.count({
        where: {
          transport: 'email',
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
      this.prisma.pushSubscription.count({
        where: {
          isActive: true,
        },
      }),
    ]);

    const now = new Date();
    const range = this.normalizeDateRange(input);
    const from = range.from;
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const ticketsInRange = tickets.filter(
      (ticket) => ticket.createdAt >= range.from && ticket.createdAt <= range.to,
    );
    const supplierRequestsInRange = supplierRequests.filter(
      (request) =>
        request.createdAt >= range.from && request.createdAt <= range.to,
    );
    const newDialogs = tickets.filter(
      (ticket) => ticket.status === 'new',
    ).length;
    const inProgressDialogs = tickets.filter(
      (ticket) =>
        ticket.status === 'in_progress' ||
        ticket.status === 'waiting_supplier' ||
        ticket.status === 'waiting_client',
    ).length;
    const resolvedDialogs = tickets.filter(
      (ticket) => ticket.status === 'resolved' || ticket.status === 'closed',
    ).length;
    const slaBreaches =
      tickets.filter(
        (ticket) => ticket.slaBreached || ticket.firstResponseBreached,
      ).length +
      supplierRequests.filter((request) => request.responseBreached).length;

    const managerLoadMap = new Map<string, number>();
    const supplierLoadMap = new Map<string, number>();
    const managerRiskMap = new Map<string, number>();
    const activeTradePointKeys = new Set<string>();

    for (const ticket of ticketsInRange) {
      const tradePointKey =
        ticket.tradePointExternalId?.trim() ||
        ticket.tradePointName?.trim() ||
        ticket.clientEmail?.trim()?.toLowerCase() ||
        ticket.clientId?.trim();

      if (tradePointKey) {
        activeTradePointKeys.add(tradePointKey);
      }
    }

    for (const ticket of ticketsInRange) {
      if (ticket.assignedManagerId) {
        managerLoadMap.set(
          ticket.assignedManagerId,
          (managerLoadMap.get(ticket.assignedManagerId) ?? 0) + 1,
        );

        if (ticket.slaBreached || ticket.firstResponseBreached) {
          managerRiskMap.set(
            ticket.assignedManagerId,
            (managerRiskMap.get(ticket.assignedManagerId) ?? 0) + 1,
          );
        }
      }

      if (ticket.supplierId) {
        supplierLoadMap.set(
          ticket.supplierId,
          (supplierLoadMap.get(ticket.supplierId) ?? 0) + 1,
        );
      }
    }

    const dialogsWithoutAnswer = tickets.filter((ticket) => {
      const baseline = ticket.lastMessageAt ?? ticket.createdAt;

      return (
        (ticket.status === 'new' || ticket.status === 'waiting_client') &&
        now.getTime() - baseline.getTime() > 2 * 60 * 1000
      );
    });
    const overdueSupplierRequests = supplierRequests.filter(
      (request) => request.responseBreached,
    );
    const systemErrorsCount = 0;
    const complaintDialogsCount = tickets.filter(
      (ticket) => ticket.slaBreached || ticket.firstResponseBreached,
    ).length;

    const problematicDialogs = tickets
      .map((ticket) => {
        const baseline = ticket.lastMessageAt ?? ticket.createdAt;
        const waitMs = Math.max(now.getTime() - baseline.getTime(), 0);
        let priority = 0;
        let issue = 'Требует проверки';
        const supplierCompanyName =
          ticket.supplierProfile?.companyName?.trim() ||
          ticket.supplierName?.trim() ||
          null;
        const supplierProfileName = ticket.supplierProfile?.fullName?.trim();
        const supplierContactName =
          supplierProfileName &&
          supplierProfileName !== supplierCompanyName &&
          supplierProfileName !== ticket.supplierName?.trim()
            ? supplierProfileName
            : null;
        const managerName =
          ticket.assignedManagerProfile?.fullName?.trim() ||
          ticket.assignedManagerName?.trim() ||
          'Не назначен';

        if (ticket.status === 'resolved' || ticket.status === 'closed') {
          return {
            id: ticket.id,
            title: ticket.title || 'Диалог без названия',
            managerName,
            supplierName: ticket.supplierName || null,
            supplierCompanyName,
            supplierContactName,
            status: ticket.status,
            priority,
            issue,
            waitMs,
          };
        }

        if (ticket.slaBreached) {
          priority += 100;
          issue = `SLA менеджера просрочен на ${Math.round(waitMs / 60000)} мин`;
        } else if (ticket.firstResponseBreached) {
          priority += 90;
          issue = `Клиент ждёт первый ответ ${Math.round(waitMs / 60000)} мин`;
        } else if (ticket.status === 'waiting_supplier') {
          const request = supplierRequests
            .filter((item) => item.ticketId === ticket.id)
            .sort(
              (left, right) =>
                (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0),
            )[0];

          if (request?.responseBreached) {
            priority += 85;
            issue = `Поставщик просрочил SLA по ${request.supplierName || 'запросу'}`;
          } else {
            priority += 60;
            issue = 'Диалог завис у поставщика';
          }
        } else if (ticket.status === 'new' || ticket.status === 'waiting_client') {
          priority += Math.min(Math.round(waitMs / 60000), 59);
          issue = `Без ответа ${Math.round(waitMs / 60000)} мин`;
        } else if (waitMs > 60 * 60 * 1000) {
          priority += 35;
          issue = 'Долгий диалог без решения';
        }

        return {
          id: ticket.id,
          title: ticket.title || 'Диалог без названия',
          managerName,
          supplierName: ticket.supplierName || null,
          supplierCompanyName,
          supplierContactName,
          status: ticket.status,
          priority,
          issue,
          waitMs,
        };
      })
      .filter((ticket) => ticket.priority > 0)
      .sort(
        (left, right) =>
          right.priority - left.priority || right.waitMs - left.waitMs,
      )
      .slice(0, 7);

    const team = profiles
      .filter((profile) => profile.role === 'manager')
      .map((profile) => {
        const presenceStatus = this.resolveManagerPresenceStatus(
          profile.managerStatus,
          profile.managerPresenceHeartbeatAt,
        );

        return {
          id: profile.id,
          fullName: profile.fullName,
          status: presenceStatus,
          dialogs: managerLoadMap.get(profile.id) ?? 0,
          slaRisk: managerRiskMap.get(profile.id) ?? 0,
          overloaded: (managerLoadMap.get(profile.id) ?? 0) >= 8,
          lastSeenAt:
            profile.managerPresenceHeartbeatAt ?? profile.lastLoginAt ?? null,
        };
      })
      .sort((left, right) => {
        const statusRank = { online: 0, break: 1, offline: 2 } as const;
        return (
          statusRank[left.status as keyof typeof statusRank] -
            statusRank[right.status as keyof typeof statusRank] ||
          right.dialogs - left.dialogs ||
          left.fullName.localeCompare(right.fullName, 'ru')
        );
      });

    const recentEvents = [
      ...claimMessages.map((message) => ({
        id: `claim_${message.id}`,
        type: 'dialog_claim',
        title: message.ticket?.assignedManagerName
          ? `${message.ticket.assignedManagerName} взял диалог в работу`
          : 'Диалог взят в работу',
        description: message.ticket?.title ?? 'Диалог TouchSpace',
        createdAt: message.createdAt,
      })),
      ...recentRegistrations.map((item) => ({
        id: `registration_${item.id}`,
        type: 'registration',
        title:
          item.status === 'approved'
            ? 'Регистрация одобрена'
            : item.status === 'rejected'
              ? 'Регистрация отклонена'
              : 'Новая регистрация',
        description: `${item.fullName} • ${this.buildStatusLabel(item.status)}`,
        createdAt: item.reviewedAt ?? item.createdAt,
      })),
      ...recentSystemMessages.map((message) => ({
        id: `system_${message.id}`,
        type: 'system',
        title: message.content,
        description: message.ticket?.title ?? 'Системное событие',
        createdAt: message.createdAt,
      })),
      ...recentAdminEvents.map((event) => ({
        id: `admin_${event.id}`,
        type: event.type,
        title: event.title,
        description:
          event.description ??
          [
            event.actorProfile?.fullName
              ? `Администратор: ${event.actorProfile.fullName}`
              : null,
            event.targetProfile?.fullName
              ? `Пользователь: ${event.targetProfile.fullName}`
              : null,
          ]
            .filter(Boolean)
            .join(' • '),
        createdAt: event.createdAt,
      })),
    ]
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )
      .slice(0, 8);

    const systemStatus = [
      {
        key: 'api',
        label: 'API',
        status: 'ok',
        detail: 'Доступно',
      },
      {
        key: 'db',
        label: 'База данных',
        status: 'ok',
        detail: 'Запросы выполняются',
      },
      {
        key: 'websocket',
        label: 'WebSocket',
        status: team.some((item) => item.status === 'online') ? 'ok' : 'warn',
        detail: team.some((item) => item.status === 'online')
          ? 'Есть активные операторы'
          : 'Нет активных подключений',
      },
      {
        key: 'email',
        label: 'Email',
        status: emailMessagesCount > 0 ? 'ok' : 'warn',
        detail:
          emailMessagesCount > 0
            ? `Сообщения за 24 ч: ${emailMessagesCount}`
            : 'Нет email-активности за 24 ч',
      },
      {
        key: 'push',
        label: 'Push',
        status: pushSubscriptionsCount > 0 ? 'ok' : 'warn',
        detail:
          pushSubscriptionsCount > 0
            ? `Активных подписок: ${pushSubscriptionsCount}`
            : 'Нет активных push-подписок',
      },
      {
        key: 'polling',
        label: 'Очереди и polling',
        status: 'ok',
        detail: overdueSupplierRequests.length > 0 ? 'Есть очередь на разбор' : 'Без сбоев',
      },
    ];

    const dialogsByDay = this.buildTimeSeries(ticketsInRange, from, range.to);
    const totalChatRequests = ticketsInRange.reduce(
      (total, ticket) => total + (ticket.requestCount ?? 1),
      0,
    );
    const avgDialogsPerDay =
      dialogsByDay.length > 0
        ? Math.round(
            dialogsByDay.reduce((total, item) => total + item.count, 0) /
              dialogsByDay.length,
          )
        : 0;

    return {
      period: range,
      metrics: {
        totalDialogs: ticketsInRange.length,
        newDialogs,
        inProgressDialogs,
        resolvedDialogs,
        dialogsToday: tickets.filter((ticket) => ticket.createdAt >= todayStart).length,
        resolvedToday: tickets.filter(
          (ticket) =>
            (ticket.status === 'resolved' || ticket.status === 'closed') &&
            (ticket.lastMessageAt ?? ticket.createdAt) >= todayStart,
        ).length,
        avgFirstResponseMs: this.average(
          ticketsInRange.map((ticket) => ticket.firstResponseTime),
        ),
        avgSupplierResponseMs: this.average(
          supplierRequestsInRange.map((request) => request.responseTime),
        ),
        activeManagers: profiles.filter((profile) => profile.role === 'manager')
          .length,
        activeSuppliers: profiles.filter(
          (profile) => profile.role === 'supplier',
        ).length,
        onlineManagers: profiles.filter(
          (profile) =>
            profile.role === 'manager' &&
            this.resolveManagerPresenceStatus(
              profile.managerStatus,
              profile.managerPresenceHeartbeatAt,
            ) === 'online',
        ).length,
        slaBreaches,
        pendingRegistrations: registrationsPending,
        activeTradePoints: activeTradePointKeys.size,
        totalChatRequests,
        totalSupplierRequests: supplierRequestsInRange.length,
        avgDialogsPerDay,
      },
      attention: {
        dialogsWithoutAnswer: dialogsWithoutAnswer.length,
        supplierOverdue: overdueSupplierRequests.length,
        pendingRegistrations: registrationsPending,
        complaintDialogs: complaintDialogsCount,
        systemErrors: systemErrorsCount,
      },
      lists: {
        problematicDialogs,
        team,
        recentEvents,
        systemStatus,
      },
      charts: {
        dialogsByDay,
        managerLoad: [...managerLoadMap.entries()]
          .map(([entityId, dialogs]) => ({ entityId, dialogs }))
          .sort((left, right) => right.dialogs - left.dialogs)
          .slice(0, 5),
        supplierLoad: [...supplierLoadMap.entries()]
          .map(([entityId, dialogs]) => ({ entityId, dialogs }))
          .sort((left, right) => right.dialogs - left.dialogs)
          .slice(0, 5),
        topReasons: this.buildTopicBuckets(ticketsInRange),
        liveManagers: profiles
          .filter((profile) => profile.role === 'manager')
          .map((profile) => ({
            id: profile.id,
            fullName: profile.fullName,
            presenceStatus: this.resolveManagerPresenceStatus(
              profile.managerStatus,
              profile.managerPresenceHeartbeatAt,
            ),
          }))
          .sort((left, right) =>
            left.fullName.localeCompare(right.fullName, 'ru'),
          ),
        claimAuditTrail: claimMessages.map((message) => ({
          id: message.id,
          ticketId: message.ticketId,
          title: message.ticket?.title ?? 'Диалог TouchSpace',
          managerName: message.ticket?.assignedManagerName ?? 'Менеджер',
          claimedAt: message.createdAt,
          content: message.content,
        })),
      },
    };
  }

  async getRegistrations(filters: RegistrationsFilter) {
    const items = await this.prisma.registrationRequest.findMany({
      where: {
        ...(filters.role ? { role: filters.role } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
      include: {
        profile: {
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            status: true,
          },
        },
        reviewedByAdmin: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        fullName: item.fullName,
        email: item.email,
        companyName: item.companyName,
        role: item.role,
        status: item.status,
        comment: item.comment,
        createdAt: item.createdAt,
        reviewedAt: item.reviewedAt,
        reviewedByAdmin: item.reviewedByAdmin,
      })),
      summary: {
        total: items.length,
        pending: items.filter((item) => item.status === 'pending').length,
        approved: items.filter((item) => item.status === 'approved').length,
        rejected: items.filter((item) => item.status === 'rejected').length,
      },
    };
  }

  async getRegistration(id: string) {
    const item = await this.prisma.registrationRequest.findUnique({
      where: { id },
      include: {
        profile: true,
        reviewedByAdmin: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundException(`Registration with id "${id}" not found`);
    }

    return item;
  }

  async createRegistration(body: {
    fullName: string;
    email: string;
    role: string;
    companyName?: string;
    comment?: string;
  }) {
    return this.prisma.registrationRequest.create({
      data: {
        fullName: body.fullName,
        email: body.email,
        role: body.role,
        companyName: body.companyName ?? null,
        comment: body.comment ?? null,
        status: 'pending',
      },
    });
  }

  async approveRegistration(
    id: string,
    body?: { adminId?: string; comment?: string },
  ) {
    const registration = await this.prisma.registrationRequest.findUnique({
      where: { id },
    });

    if (!registration) {
      throw new NotFoundException(`Registration with id "${id}" not found`);
    }

    const profileId = registration.profileId ?? `profile_${registration.id}`;

    const profile = await this.profilesService.ensureProfile({
      id: profileId,
      fullName: registration.fullName,
      email: registration.email,
      role: registration.role,
      companyName: registration.companyName,
      status: 'active',
      approvalStatus: 'approved',
      approvalComment: body?.comment ?? registration.comment,
      createdByAdminId: body?.adminId ?? null,
      isActive: true,
    });

    const credentials =
      profile && !profile.passwordHash
        ? await this.authService.issueCredentialsForProfile(
            profile.id,
            registration.email,
          )
        : null;

    const updatedRegistration = await this.prisma.registrationRequest.update({
      where: { id },
      data: {
        status: 'approved',
        comment: body?.comment ?? registration.comment,
        reviewedByAdminId: body?.adminId ?? null,
        reviewedAt: new Date(),
        profileId,
      },
    });

    return {
      ...updatedRegistration,
      credentials,
    };
  }

  async rejectRegistration(
    id: string,
    body?: { adminId?: string; comment?: string },
  ) {
    const registration = await this.prisma.registrationRequest.findUnique({
      where: { id },
    });

    if (!registration) {
      throw new NotFoundException(`Registration with id "${id}" not found`);
    }

    if (registration.profileId) {
      await this.prisma.profile.updateMany({
        where: { id: registration.profileId },
        data: {
          status: 'blocked',
          approvalStatus: 'rejected',
          approvalComment: body?.comment ?? registration.comment,
          isActive: false,
        },
      });
    }

    return this.prisma.registrationRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        comment: body?.comment ?? registration.comment,
        reviewedByAdminId: body?.adminId ?? null,
        reviewedAt: new Date(),
      },
    });
  }

  async getUsers(filters: UsersFilter) {
    const from = this.toDate(filters.dateFrom);
    const to = this.toDate(filters.dateTo);
    const normalizedRole = filters.role?.trim() || '';

    if (normalizedRole === 'client') {
      return {
        items: [],
        total: 0,
      };
    }

    const users = await this.prisma.profile.findMany({
      where: {
        ...(normalizedRole
          ? { role: normalizedRole }
          : {
              role: {
                in: [...this.adminUsersVisibleRoles],
              },
            }),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.company
          ? {
              companyName: {
                contains: filters.company,
              },
            }
          : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      include: {
        clientTickets: {
          select: { id: true },
        },
        assignedManagerTickets: {
          select: { id: true },
        },
        supplierRequests: {
          select: { id: true },
        },
        registrationRequests: {
          select: { id: true, status: true, createdAt: true },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
        supervisor: {
          select: {
            id: true,
            fullName: true,
            companyName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      items: users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        authLogin: user.authLogin,
        role: user.role,
        status: user.status,
        approvalStatus: user.approvalStatus,
        companyName: user.companyName,
        supplierId: user.supplierId,
        supervisorProfileId: user.supervisorProfileId,
        supervisorName: user.supervisor?.fullName ?? null,
        lastLoginAt: user.lastLoginAt,
        passwordChangeRequired: user.passwordChangeRequired,
        isActive: user.isActive,
        createdAt: user.createdAt,
        dialogsCount:
          user.clientTickets.length + user.assignedManagerTickets.length,
        supplierRequestsCount: user.supplierRequests.length,
        latestRegistrationStatus: user.registrationRequests[0]?.status ?? null,
      })),
      total: users.length,
    };
  }

  async getUser(id: string) {
    const user = await this.prisma.profile.findUnique({
      where: { id },
      include: {
        clientTickets: {
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        assignedManagerTickets: {
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        supplierRequests: {
          select: { id: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        supervisor: {
          select: {
            id: true,
            fullName: true,
            role: true,
            companyName: true,
          },
        },
        supervisedProfiles: {
          select: {
            id: true,
            fullName: true,
            role: true,
            email: true,
            companyName: true,
          },
          orderBy: {
            fullName: 'asc',
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    if (user.role === 'client') {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    return user;
  }

  async createUser(body: {
    fullName?: string;
    email?: string;
    authLogin?: string;
    password?: string;
    role: string;
    companyName?: string;
    createdByAdminId?: string;
    status?: string;
  }, adminContext?: AdminActorContext) {
    const role = this.normalizeRole(body.role);
    const email = this.normalizeEmail(body.email);
    const authLogin = body.authLogin
      ? this.sanitizeLoginCandidate(body.authLogin)
      : email;
    const companyName = this.normalizeCompanyName(body.companyName);
    const fullName =
      body.fullName?.trim() ||
      (role === 'admin'
        ? 'Администратор'
        : role === 'supplier_supervisor'
          ? 'Управленец поставщика'
          : role === 'manager_supervisor'
            ? 'Управленец менеджеров'
            : role === 'supplier'
              ? 'Поставщик'
              : 'Менеджер');
    const password = body.password?.trim() || null;

    if (role !== 'client' && !email) {
      throw new BadRequestException('Email обязателен для внутренних ролей');
    }

    if ((role === 'supplier' || role === 'supplier_supervisor') && !companyName) {
      throw new BadRequestException(
        'Для поставщика и управленца поставщика нужно указать компанию',
      );
    }

    await this.ensureUniqueProfileFields({
      email,
      authLogin,
    });

    let supplierScopeId: string | null = null;
    let supervisorProfileId: string | null = null;

    if (role === 'supplier_supervisor' && companyName) {
      const existingSupervisor = await this.resolveSupplierSupervisorByCompany(
        companyName,
      );

      if (existingSupervisor) {
        throw new BadRequestException(
          `Для компании "${companyName}" уже создан управленец поставщика`,
        );
      }

      supplierScopeId = this.buildSupplierScopeId(companyName);
    }

    if (role === 'supplier' && companyName) {
      const supervisor = await this.resolveSupplierSupervisorByCompany(companyName);

      if (!supervisor) {
        throw new BadRequestException(
          `Сначала создайте управленца поставщика для компании "${companyName}"`,
        );
      }

      supplierScopeId =
        supervisor.supplierId?.trim() || this.buildSupplierScopeId(companyName);
      supervisorProfileId = supervisor.id;
    }

    const profileId = `manual_${Date.now()}`;

    const profile = await this.prisma.profile.create({
      data: {
        id: profileId,
        fullName,
        email,
        authLogin: authLogin || null,
        role,
        status: body.status ?? 'active',
        approvalStatus: 'approved',
        companyName,
        supplierId: supplierScopeId,
        supervisorProfileId,
        createdByAdminId:
          body.createdByAdminId?.trim() || adminContext?.adminId?.trim() || null,
        isActive: true,
      },
    });

    const credentials = password
      ? await this.authService.setCredentialsForProfile(
          profile.id,
          password,
          authLogin || email,
        )
      : await this.authService.issueCredentialsForProfile(
          profile.id,
          authLogin || email,
        );

    if (role === 'supplier_supervisor' && companyName && supplierScopeId) {
      await this.backfillSuppliersForSupervisor(
        profile.id,
        companyName,
        supplierScopeId,
      );
    }

    await this.logAdminEvent({
      type: 'user_created',
      title: 'Администратор создал пользователя',
      description: `${fullName} • ${role}`,
      actor: adminContext,
      targetProfileId: profile.id,
      metadata: {
        role,
        authLogin: credentials.login,
        passwordChangeRequired: credentials.passwordChangeRequired,
      },
    });

    return {
      profile,
      credentials,
    };
  }

  async updateUser(
    id: string,
    body: {
      role?: string;
      status?: string;
      isActive?: boolean;
      companyName?: string;
      fullName?: string;
      email?: string | null;
      authLogin?: string | null;
      supervisorProfileId?: string | null;
      approvalStatus?: string;
      lastLoginAt?: string | null;
    },
  ) {
    const existing = await this.prisma.profile.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        companyName: true,
        supplierId: true,
      },
    });

    if (!existing) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    const nextRole = body.role ? this.normalizeRole(body.role) : existing.role;
    const nextCompanyName =
      body.companyName !== undefined
        ? this.normalizeCompanyName(body.companyName)
        : existing.companyName;
    const nextEmail =
      body.email !== undefined ? this.normalizeEmail(body.email) : undefined;
    const nextAuthLogin =
      body.authLogin !== undefined
        ? body.authLogin
          ? this.sanitizeLoginCandidate(body.authLogin)
          : null
        : undefined;

    if (
      (nextRole === 'supplier' || nextRole === 'supplier_supervisor') &&
      !nextCompanyName
    ) {
      throw new BadRequestException(
        'Для поставщика и управленца поставщика нужно указать компанию',
      );
    }

    await this.ensureUniqueProfileFields({
      email: nextEmail ?? undefined,
      authLogin: nextAuthLogin ?? undefined,
      excludedProfileId: id,
    });

    let supplierScopeId =
      nextRole === 'supplier' || nextRole === 'supplier_supervisor'
        ? existing.supplierId?.trim() || null
        : null;
    let supervisorProfileId =
      body.supervisorProfileId !== undefined
        ? body.supervisorProfileId?.trim() || null
        : undefined;

    if (nextRole === 'supplier_supervisor' && nextCompanyName) {
      const otherSupervisor = await this.resolveSupplierSupervisorByCompany(
        nextCompanyName,
        id,
      );

      if (otherSupervisor) {
        throw new BadRequestException(
          `Для компании "${nextCompanyName}" уже создан другой управленец поставщика`,
        );
      }

      supplierScopeId =
        existing.supplierId?.trim() ||
        this.buildSupplierScopeId(nextCompanyName);
      supervisorProfileId = null;
    }

    if (nextRole === 'supplier' && nextCompanyName) {
      if (supervisorProfileId === undefined) {
        const supervisor = await this.resolveSupplierSupervisorByCompany(
          nextCompanyName,
        );

        if (!supervisor) {
          throw new BadRequestException(
            `Не найден управленец поставщика для компании "${nextCompanyName}"`,
          );
        }

        supplierScopeId =
          supervisor.supplierId?.trim() ||
          this.buildSupplierScopeId(nextCompanyName);
        supervisorProfileId = supervisor.id;
      } else if (supervisorProfileId) {
        const linkedSupervisor = await this.prisma.profile.findFirst({
          where: {
            id: supervisorProfileId,
            role: 'supplier_supervisor',
          },
          select: {
            id: true,
            companyName: true,
            supplierId: true,
          },
        });

        if (!linkedSupervisor) {
          throw new BadRequestException('Указанный управленец поставщика не найден');
        }

        if (linkedSupervisor.companyName !== nextCompanyName) {
          throw new BadRequestException(
            'Компания поставщика должна совпадать с компанией управленца',
          );
        }

        supplierScopeId =
          linkedSupervisor.supplierId?.trim() ||
          this.buildSupplierScopeId(nextCompanyName);
      }
    }

    const updatedProfile = await this.prisma.profile.update({
      where: { id },
      data: {
        ...(body.role ? { role: nextRole } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(typeof body.isActive === 'boolean'
          ? { isActive: body.isActive }
          : {}),
        ...(body.companyName !== undefined
          ? { companyName: nextCompanyName }
          : {}),
        ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
        ...(body.email !== undefined ? { email: nextEmail } : {}),
        ...(body.authLogin !== undefined ? { authLogin: nextAuthLogin } : {}),
        ...(nextRole === 'supplier' || nextRole === 'supplier_supervisor'
          ? { supplierId: supplierScopeId }
          : { supplierId: null, supervisorProfileId: null }),
        ...(nextRole === 'supplier'
          ? { supervisorProfileId: supervisorProfileId ?? null }
          : {}),
        ...(body.approvalStatus ? { approvalStatus: body.approvalStatus } : {}),
        ...(body.lastLoginAt !== undefined
          ? { lastLoginAt: this.toDate(body.lastLoginAt, null) }
          : {}),
      },
    });

    if (nextRole === 'supplier_supervisor' && nextCompanyName && supplierScopeId) {
      await this.backfillSuppliersForSupervisor(id, nextCompanyName, supplierScopeId);
    }

    return updatedProfile;
  }

  async reissueUserPassword(id: string, adminContext?: AdminActorContext) {
    const user = await this.prisma.profile.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    const credentials = await this.authService.issueCredentialsForProfile(
      user.id,
      user.authLogin ?? user.email ?? undefined,
    );

    await this.logAdminEvent({
      type: 'password_reissued',
      title: 'Администратор сбросил пароль',
      description: `${user.fullName} должен сменить пароль при следующем входе`,
      actor: adminContext,
      targetProfileId: user.id,
      metadata: {
        authLogin: credentials.login,
        passwordChangeRequired: true,
      },
    });

    return {
      userId: user.id,
      fullName: user.fullName,
      credentials,
    };
  }

  async deleteUser(id: string, adminContext?: AdminActorContext) {
    const user = await this.prisma.profile.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        authLogin: true,
        role: true,
        companyName: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }

    if (adminContext?.adminId?.trim() && adminContext.adminId.trim() === user.id) {
      throw new BadRequestException('Нельзя удалить собственную учётную запись');
    }

    if (user.role === 'admin') {
      const otherAdminsCount = await this.prisma.profile.count({
        where: {
          role: 'admin',
          id: {
            not: user.id,
          },
        },
      });

      if (otherAdminsCount <= 0) {
        throw new BadRequestException('Нельзя удалить последнего администратора');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.managerMessageSuggestion.deleteMany({
        where: {
          managerId: user.id,
        },
      });

      await tx.profile.delete({
        where: {
          id: user.id,
        },
      });
    });

    await this.logAdminEvent({
      type: 'user_deleted',
      title: 'Учётная запись удалена',
      description: user.fullName,
      actor: adminContext,
      metadata: {
        deletedUserId: user.id,
        role: user.role,
        email: user.email,
        authLogin: user.authLogin,
        companyName: user.companyName,
      },
    });

    return {
      ok: true,
    };
  }

  async getDialogs(filters: DialogsFilter) {
    const dialogs = await this.prisma.ticket.findMany({
      where: this.buildDialogsWhere(filters),
      include: {
        supplierRequests: {
          select: {
            id: true,
            supplierId: true,
            status: true,
            responseBreached: true,
          },
        },
        messages: {
          select: {
            id: true,
            content: true,
            senderType: true,
            senderRole: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      items: dialogs.map((dialog) => ({
        id: dialog.id,
        title: dialog.title,
        clientName:
          dialog.clientName ||
          dialog.tradePointName ||
          dialog.clientEmail ||
          dialog.currentUserEmail ||
          'Клиент не указан',
        managerName: dialog.assignedManagerName,
        managerId: dialog.assignedManagerId,
        supplierName: dialog.supplierName,
        supplierId: dialog.supplierId,
        status: dialog.status,
        createdAt: dialog.createdAt,
        lastMessageAt: dialog.lastMessageAt,
        firstResponseAt: dialog.firstResponseAt,
        firstResponseTime: dialog.firstResponseTime,
        supplierEscalated: Boolean(
          dialog.supplierEscalatedAt || dialog.supplierRequests.length,
        ),
        slaBreached:
          dialog.slaBreached ||
          dialog.firstResponseBreached ||
          dialog.supplierRequests.some((request) => request.responseBreached),
        messagesCount: dialog.messages.length,
        lastMessagePreview: dialog.messages[0]?.content ?? null,
      })),
      total: dialogs.length,
    };
  }

  async getDialog(id: string, input?: DateRangeInput) {
    const dialog = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
        },
        supplierRequests: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    });

    if (!dialog) {
      throw new NotFoundException(`Dialog with id "${id}" not found`);
    }

    const range = this.normalizeDateRange(input);
    const clientWhere = this.buildClientDialogWhere(dialog);
    const clientDialogs = await this.prisma.ticket.findMany({
      where: {
        AND: [
          clientWhere,
          {
            conversationMode: {
              not: 'direct_supplier',
            },
          },
          {
            createdAt: {
              gte: range.from,
              lte: range.to,
            },
          },
        ],
      },
      include: {
        supplierRequests: {
          select: {
            id: true,
            responseBreached: true,
          },
        },
      },
    });
    const supplierRequestsCount = clientDialogs.reduce(
      (total, ticket) => total + ticket.supplierRequests.length,
      0,
    );

    return {
      ...dialog,
      displayClientName:
        dialog.clientName ||
        dialog.tradePointName ||
        dialog.clientEmail ||
        dialog.currentUserEmail ||
        'Клиент не указан',
      period: range,
      clientStats: {
        dialogsTotal: clientDialogs.length,
        completedDialogs: clientDialogs.filter(
          (ticket) =>
            ticket.status === 'resolved' ||
            ticket.status === 'closed' ||
            Boolean(ticket.resolvedAt) ||
            Boolean(ticket.closedAt),
        ).length,
        supplierRequestsCount,
        managerSlaBreaches: clientDialogs.filter(
          (ticket) => ticket.slaBreached || ticket.firstResponseBreached,
        ).length,
        supplierSlaBreaches: clientDialogs.reduce(
          (total, ticket) =>
            total +
            ticket.supplierRequests.filter((request) => request.responseBreached)
              .length,
          0,
        ),
      },
      metrics: {
        firstResponseAt: dialog.firstResponseAt,
        firstResponseTime: dialog.firstResponseTime,
        supplierResponseTime: this.average(
          dialog.supplierRequests.map((request) => request.responseTime),
        ),
        supplierEscalated: Boolean(
          dialog.supplierEscalatedAt || dialog.supplierRequests.length,
        ),
        slaBreached:
          dialog.slaBreached ||
          dialog.firstResponseBreached ||
          dialog.supplierRequests.some((request) => request.responseBreached),
      },
      ai: {
        topicCategory: dialog.topicCategory,
        sentiment: dialog.sentiment,
        aiSummary: dialog.aiSummary,
        aiTags: readJsonStringArray(dialog.aiTags),
        insightFlags: readJsonStringArray(dialog.insightFlags),
      },
    };
  }

  async getAnalyticsOverview(input?: DateRangeInput) {
    const range = this.normalizeDateRange(input);
    const tickets = await this.prisma.ticket.findMany({
      where: {
        createdAt: {
          gte: range.from,
          lte: range.to,
        },
      },
      include: {
        messages: {
          select: {
            id: true,
          },
        },
        supplierRequests: {
          select: {
            id: true,
            responseBreached: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return {
      period: range,
      metrics: {
        dialogs: tickets.length,
        newDialogs: tickets.filter((ticket) => ticket.status === 'new').length,
        resolvedDialogs: tickets.filter(
          (ticket) =>
            ticket.status === 'resolved' || ticket.status === 'closed',
        ).length,
        overdueDialogs: tickets.filter(
          (ticket) =>
            ticket.slaBreached ||
            ticket.firstResponseBreached ||
            ticket.supplierRequests.some((request) => request.responseBreached),
        ).length,
        avgFirstResponseMs: this.average(
          tickets.map((ticket) => ticket.firstResponseTime),
        ),
        avgCloseTimeMs: this.average(
          tickets.map((ticket) => ticket.resolutionTime),
        ),
        escalatedShare: tickets.length
          ? Number(
              (
                tickets.filter(
                  (ticket) =>
                    Boolean(ticket.supplierEscalatedAt) ||
                    ticket.supplierRequests.length > 0,
                ).length / tickets.length
              ).toFixed(2),
            )
          : 0,
        avgMessagesPerDialog: tickets.length
          ? Number(
              (
                tickets.reduce(
                  (total, ticket) => total + ticket.messages.length,
                  0,
                ) / tickets.length
              ).toFixed(1),
            )
          : 0,
      },
      charts: {
        dialogsByDay: this.buildTimeSeries(tickets, range.from, range.to),
        topTopics: this.buildTopicBuckets(tickets),
      },
    };
  }

  async getInsightsAnalytics(input?: DateRangeInput) {
    const range = this.normalizeDateRange(input);
    const tickets = await this.prisma.ticket.findMany({
      where: {
        createdAt: {
          gte: range.from,
          lte: range.to,
        },
      },
      include: {
        messages: {
          select: {
            content: true,
            senderType: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
          take: 20,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const weekdayDistribution = this.buildWeekdayDistribution(tickets);
    const hourDistribution = this.buildHourDistribution(tickets);
    const topTopics = this.buildTopicBuckets(tickets);
    const keywordInsights = this.buildKeywordInsights(tickets);
    const { aiTickets, aiTopics, aiTriggers } =
      this.buildAiRequestInsights(tickets);
    const busiestWeekday =
      weekdayDistribution.slice().sort((a, b) => b.count - a.count)[0] ?? null;
    const busiestHour =
      hourDistribution.slice().sort((a, b) => b.count - a.count)[0] ?? null;
    const totalDays = Math.max(
      Math.ceil(
        (range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000),
      ),
      1,
    );

    return {
      period: range,
      summary: {
        totalDialogs: tickets.length,
        avgDialogsPerDay: Number((tickets.length / totalDays).toFixed(1)),
        busiestWeekday,
        busiestHour,
        aiDialogs: aiTickets.length,
        aiShare: tickets.length
          ? Number(((aiTickets.length / tickets.length) * 100).toFixed(1))
          : 0,
        aiResolved: aiTickets.filter((ticket) => ticket.aiResolved).length,
        aiHandedToManager: aiTickets.filter((ticket) =>
          Boolean(ticket.handedToManagerAt),
        ).length,
        aiActivations: tickets.filter((ticket) => Boolean(ticket.aiActivatedAt))
          .length,
      },
      charts: {
        byHour: hourDistribution,
        byWeekday: weekdayDistribution,
      },
      topics: topTopics,
      triggers: keywordInsights,
      aiUsage: {
        topics: aiTopics,
        triggers: aiTriggers,
      },
    };
  }

  async getManagerAnalytics(input?: DateRangeInput) {
    const range = this.normalizeDateRange(input);
    const [managers, tickets] = await Promise.all([
      this.prisma.profile.findMany({
        where: {
          role: 'manager',
        },
        select: {
          id: true,
          fullName: true,
          companyName: true,
          status: true,
          managerStatus: true,
          managerPresenceHeartbeatAt: true,
        },
      }),
      this.prisma.ticket.findMany({
        where: {
          createdAt: {
            gte: range.from,
            lte: range.to,
          },
        },
        include: {
          supplierRequests: {
            select: {
              id: true,
            },
          },
        },
      }),
    ]);

    const items = managers.map((manager) => {
      const relatedTickets = tickets.filter(
        (ticket) =>
          ticket.assignedManagerId === manager.id ||
          ticket.lastResolvedByManagerId === manager.id,
      );

      return {
        id: manager.id,
        fullName: manager.fullName,
        companyName: manager.companyName,
        status: manager.status,
        presenceStatus: this.resolveManagerPresenceStatus(
          manager.managerStatus,
          manager.managerPresenceHeartbeatAt,
        ),
        dialogsInWork: relatedTickets.filter(
          (ticket) =>
            ticket.assignedManagerId === manager.id &&
            ticket.status !== 'resolved',
        ).length,
        handledDialogs: relatedTickets.length,
        avgFirstResponseMs: this.average(
          relatedTickets.map((ticket) => ticket.firstResponseTime),
        ),
        avgCloseTimeMs: this.average(
          relatedTickets.map((ticket) => ticket.resolutionTime),
        ),
        avgRating: this.average(
          relatedTickets.map((ticket) => ticket.managerRating),
        ),
        ratingsCount: relatedTickets.filter(
          (ticket) => typeof ticket.managerRating === 'number',
        ).length,
        slaBreaches: relatedTickets.filter(
          (ticket) => ticket.firstResponseBreached || ticket.slaBreached,
        ).length,
        escalationsToSupplier: relatedTickets.filter(
          (ticket) =>
            Boolean(ticket.supplierEscalatedAt) ||
            ticket.supplierRequests.length > 0,
        ).length,
        topReasons: this.buildTopicBuckets(relatedTickets),
      };
    });

    return {
      period: range,
      livePresence: {
        online: items.filter((item) => item.presenceStatus === 'online').length,
        break: items.filter((item) => item.presenceStatus === 'break').length,
        offline: items.filter((item) => item.presenceStatus === 'offline')
          .length,
      },
      items: items.sort(
        (left, right) => right.handledDialogs - left.handledDialogs,
      ),
    };
  }

  async getManagerAnalyticsDetail(id: string, input?: DateRangeInput) {
    const range = this.normalizeDateRange(input);
    const manager = await this.prisma.profile.findUnique({
      where: { id },
    });

    if (!manager) {
      throw new NotFoundException(`Manager with id "${id}" not found`);
    }

    const tickets = await this.prisma.ticket.findMany({
      where: {
        createdAt: {
          gte: range.from,
          lte: range.to,
        },
        OR: [{ assignedManagerId: id }, { lastResolvedByManagerId: id }],
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      manager: {
        ...manager,
        presenceStatus: this.resolveManagerPresenceStatus(
          manager.managerStatus,
          manager.managerPresenceHeartbeatAt,
        ),
      },
      period: range,
      metrics: {
        dialogsInWork: tickets.filter(
          (ticket) =>
            ticket.assignedManagerId === id && ticket.status !== 'resolved',
        ).length,
        handledDialogs: tickets.length,
        avgFirstResponseMs: this.average(
          tickets.map((ticket) => ticket.firstResponseTime),
        ),
        avgCloseTimeMs: this.average(
          tickets.map((ticket) => ticket.resolutionTime),
        ),
        avgRating: this.average(tickets.map((ticket) => ticket.managerRating)),
        ratingsCount: tickets.filter(
          (ticket) => typeof ticket.managerRating === 'number',
        ).length,
        slaBreaches: tickets.filter(
          (ticket) => ticket.firstResponseBreached || ticket.slaBreached,
        ).length,
      },
      topReasons: this.buildTopicBuckets(tickets),
      dialogs: tickets.slice(0, 20),
    };
  }

  async getSupplierAnalytics(input?: DateRangeInput) {
    const range = this.normalizeDateRange(input);
    const selectedCompanyName = this.normalizeCompanyName(input?.companyName);
    const [supplierProfiles, requests] = await Promise.all([
      this.prisma.profile.findMany({
        where: {
          role: {
            in: ['supplier', 'supplier_supervisor'],
          },
        },
        select: {
          id: true,
          fullName: true,
          companyName: true,
          supplierId: true,
          role: true,
          status: true,
        },
      }),
      this.prisma.supplierRequest.findMany({
        where: {
          createdAt: {
            gte: range.from,
            lte: range.to,
          },
        },
        include: {
          ticket: {
            select: {
              id: true,
              title: true,
              topicCategory: true,
              messages: {
                where: {
                  senderType: 'supplier',
                },
                select: {
                  senderType: true,
                  senderProfileId: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const companies = [
      ...new Set(
        [
          ...supplierProfiles
            .map((profile) => this.normalizeCompanyName(profile.companyName))
            .filter((companyName): companyName is string => Boolean(companyName)),
          ...requests
            .map((request) => this.normalizeCompanyName(request.supplierName))
            .filter((companyName): companyName is string => Boolean(companyName)),
        ].sort((left, right) => left.localeCompare(right, 'ru')),
      ),
    ];

    const suppliers = supplierProfiles.filter((profile) => {
      if (profile.role !== 'supplier') {
        return false;
      }

      if (this.isSyntheticSupplierScope(profile)) {
        return false;
      }

      if (!selectedCompanyName) {
        return true;
      }

      return this.normalizeCompanyName(profile.companyName) === selectedCompanyName;
    });

    const items = suppliers.map((supplier) => {
      const supplierRequests = requests.filter(
        (request) => this.supplierRequestBelongsToProfile(request, supplier),
      );

      return {
        id: supplier.id,
        fullName: supplier.fullName,
        companyName: supplier.companyName,
        supplierScopeId: this.getSupplierProfileScope(supplier),
        status: supplier.status,
        receivedRequests: supplierRequests.length,
        answeredRequests: supplierRequests.filter(
          (request) => request.status === 'answered' || request.firstResponseAt,
        ).length,
        avgResponseMs: this.average(
          supplierRequests.map((request) => request.responseTime),
        ),
        slaBreaches: supplierRequests.filter(
          (request) => request.responseBreached,
        ).length,
        relatedDialogs: new Set(
          supplierRequests.map((request) => request.ticketId),
        ).size,
        topReasons: this.buildTopicBuckets(
          supplierRequests.map((request) => ({
            title: request.ticket.title,
            topicCategory: request.ticket.topicCategory,
          })),
        ),
      };
    });

    return {
      period: range,
      companies,
      selectedCompanyName,
      items: items.sort(
        (left, right) => right.receivedRequests - left.receivedRequests,
      ),
    };
  }

  async getSupplierAnalyticsDetail(id: string, input?: DateRangeInput) {
    const range = this.normalizeDateRange(input);
    const supplier = await this.prisma.profile.findUnique({
      where: { id },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with id "${id}" not found`);
    }

    const supplierScopeId = this.getSupplierProfileScope(supplier);
    const requestCandidates = await this.prisma.supplierRequest.findMany({
      where: {
        OR: [
          { supplierId: id },
          { supplierId: supplierScopeId },
          { assignedSupplierProfileId: id },
        ],
        createdAt: {
          gte: range.from,
          lte: range.to,
        },
      },
      include: {
        ticket: {
          include: {
            messages: {
              where: {
                senderType: 'supplier',
              },
              select: {
                senderType: true,
                senderProfileId: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    const requests = requestCandidates.filter((request) =>
      this.supplierRequestBelongsToProfile(request, supplier),
    );

    return {
      supplier,
      supplierScopeId,
      period: range,
      metrics: {
        receivedRequests: requests.length,
        answeredRequests: requests.filter(
          (request) => request.status === 'answered' || request.firstResponseAt,
        ).length,
        avgResponseMs: this.average(
          requests.map((request) => request.responseTime),
        ),
        slaBreaches: requests.filter((request) => request.responseBreached)
          .length,
        relatedDialogs: new Set(requests.map((request) => request.ticketId))
          .size,
      },
      topReasons: this.buildTopicBuckets(
        requests.map((request) => ({
          title: request.ticket.title,
          topicCategory: request.ticket.topicCategory,
        })),
      ),
      requests: requests.slice(0, 20),
    };
  }

  async getSlaSummary(input?: { dateFrom?: string; dateTo?: string }) {
    const from = this.toDate(input?.dateFrom);
    const to = this.toDate(input?.dateTo);

    const dialogs = await this.prisma.ticket.findMany({
      where: {
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      include: {
        supplierRequests: {
          select: {
            id: true,
            supplierId: true,
            supplierName: true,
            responseBreached: true,
            responseTime: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const breachedDialogs = dialogs.filter(
      (dialog) =>
        dialog.slaBreached ||
        dialog.firstResponseBreached ||
        dialog.supplierRequests.some((request) => request.responseBreached),
    );
    const managerMap = new Map<string, { name: string; breaches: number }>();
    const supplierMap = new Map<string, { name: string; breaches: number }>();

    for (const dialog of breachedDialogs) {
      if (dialog.assignedManagerId) {
        managerMap.set(dialog.assignedManagerId, {
          name: dialog.assignedManagerName ?? dialog.assignedManagerId,
          breaches:
            (managerMap.get(dialog.assignedManagerId)?.breaches ?? 0) + 1,
        });
      }

      for (const request of dialog.supplierRequests.filter(
        (supplierRequest) => supplierRequest.responseBreached,
      )) {
        if (!request.supplierId) {
          continue;
        }

        supplierMap.set(request.supplierId, {
          name: request.supplierName,
          breaches: (supplierMap.get(request.supplierId)?.breaches ?? 0) + 1,
        });
      }
    }

    return {
      summary: {
        breachedDialogs: breachedDialogs.length,
        avgManagerResponseMs: this.average(
          dialogs.map((dialog) => dialog.firstResponseTime),
        ),
        avgSupplierResponseMs: this.average(
          dialogs.flatMap((dialog) =>
            dialog.supplierRequests.map((request) => request.responseTime),
          ),
        ),
      },
      problemDialogs: breachedDialogs.slice(0, 20).map((dialog) => ({
        id: dialog.id,
        title: dialog.title,
        status: dialog.status,
        assignedManagerName: dialog.assignedManagerName,
        supplierName: dialog.supplierName,
        createdAt: dialog.createdAt,
        lastMessageAt: dialog.lastMessageAt,
      })),
      topManagers: [...managerMap.entries()]
        .map(([id, value]) => ({ id, ...value }))
        .sort((left, right) => right.breaches - left.breaches)
        .slice(0, 5),
      topSuppliers: [...supplierMap.entries()]
        .map(([id, value]) => ({ id, ...value }))
        .sort((left, right) => right.breaches - left.breaches)
        .slice(0, 5),
    };
  }
}
