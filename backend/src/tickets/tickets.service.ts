import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { InviteManagerDto } from './dto/invite-manager.dto';
import { AssignManagerDto } from './dto/assign-manager.dto';
import { RemoveInvitedManagerDto } from './dto/remove-invited-manager.dto';
import { ResolveTicketDto } from './dto/resolve-ticket.dto';
import { TypingService } from '../typing.service';
import { ProfilesService } from '../profiles.service';
import { ChatAiService } from '../chat-ai.service';
import { readJsonStringArray } from '../prisma-json.util';
import { resolveTicketClientContext } from './client-context.util';

type TicketViewer = {
  viewerType?: string;
  viewerId?: string;
  viewerEmail?: string;
  tradePointName?: string;
};

type ContactType = 'email' | 'phone';

type TicketPageViewPayload = {
  tradePointId?: string;
  tradePointName?: string;
  pageUrl?: string;
  pagePath?: string;
  pageTitle?: string;
  pageName?: string;
  routeType?: string;
  entityId?: string;
  entityName?: string;
  referrer?: string;
  timestamp?: string;
  sourceType?: string;
};

type ResolvedContactValue = {
  value: string;
  normalizedValue: string;
};

const CLIENT_AVATAR_COLORS = [
  '#FF6B6B',
  '#FF8E3C',
  '#FFB340',
  '#FFD166',
  '#7BC96F',
  '#34C759',
  '#1CC8A0',
  '#21C7D9',
  '#0A84FF',
  '#4D7CFE',
  '#6C63FF',
  '#8B5CF6',
  '#C084FC',
  '#EC4899',
  '#F06292',
  '#A3A3A3',
  '#6B7280',
  '#22A699',
];

const CLIENT_AVATAR_EMOJIS = [
  '🦊',
  '🐺',
  '🐻',
  '🐼',
  '🦉',
  '🦁',
  '🐯',
  '🐨',
  '🦔',
  '🐸',
  '🦋',
  '🐝',
  '🌵',
  '🌿',
  '🍀',
  '🌻',
  '🌷',
  '🍎',
  '🍐',
  '🍊',
  '🍋',
  '🍇',
  '🍒',
  '🥝',
];

const GENERIC_MANAGER_NAMES = new Set(['менеджер', 'manager']);

const isSpecificManagerName = (name?: string | null) => {
  const normalizedName = name?.trim().toLowerCase();
  return Boolean(normalizedName && !GENERIC_MANAGER_NAMES.has(normalizedName));
};

const isSpecificSupplierContactName = (
  name?: string | null,
  companyName?: string | null,
) => {
  const normalizedName = name?.trim().toLowerCase();
  const normalizedCompanyName = companyName?.trim().toLowerCase();

  return Boolean(
    normalizedName &&
      normalizedName !== 'поставщик' &&
      normalizedName !== 'supplier' &&
      normalizedName !== normalizedCompanyName,
  );
};

@Injectable()
export class TicketsService {
  private static readonly OFFLINE_MANAGER_AUTO_REPLY =
    'Спасибо, что написали. Сейчас менеджеры не в сети, но как только кто-то появится, мы сразу вернёмся с ответом.';
  private static readonly OFFLINE_MANAGER_AUTO_REPLY_COOLDOWN_MS =
    15 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly typingService: TypingService,
    private readonly profilesService: ProfilesService,
    private readonly chatAiService: ChatAiService,
  ) {}

  private async createSystemMessage(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    ticketId: string,
    content: string,
  ) {
    return tx.message.create({
      data: {
        ticketId,
        content,
        senderType: 'system',
        senderRole: 'system',
        status: 'sent',
        deliveryStatus: 'sent',
        messageType: 'system',
      },
    });
  }

  private async maybeCreateOfflineManagerAutoReply(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    ticketId: string,
    triggerCreatedAt: Date,
  ) {
    const hasOnlineManagers = await this.profilesService.hasOnlineManagers();

    if (hasOnlineManagers) {
      return false;
    }

    const recentOfflineReply = await tx.message.findFirst({
      where: {
        ticketId,
        senderType: 'system',
        messageType: 'system',
        content: TicketsService.OFFLINE_MANAGER_AUTO_REPLY,
        createdAt: {
          gte: new Date(
            triggerCreatedAt.getTime() -
              TicketsService.OFFLINE_MANAGER_AUTO_REPLY_COOLDOWN_MS,
          ),
        },
      },
      select: {
        id: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (recentOfflineReply) {
      return false;
    }

    await this.createSystemMessage(
      tx,
      ticketId,
      TicketsService.OFFLINE_MANAGER_AUTO_REPLY,
    );

    return true;
  }

  private buildTicketWhere(viewer?: TicketViewer) {
    const viewerId = viewer?.viewerId?.trim();
    const viewerType = viewer?.viewerType?.trim();
    const viewerEmail = this.normalizeEmailForMatching(viewer?.viewerEmail);
    const tradePointName = viewer?.tradePointName?.trim();

    if (!viewerType) {
      return undefined;
    }

    if (viewerType === 'client') {
      const orConditions: Record<string, unknown>[] = [];

      if (viewerId) {
        orConditions.push({ clientId: viewerId });
      }

      if (viewerEmail && tradePointName) {
        orConditions.push(
          { tradePointName, canonicalEmail: viewerEmail },
          { tradePointName, clientEmail: viewerEmail },
          { tradePointName, currentUserEmail: viewerEmail },
          { tradePointName, superuserEmail: viewerEmail },
        );
      }

      if (orConditions.length === 0) {
        return undefined;
      }

      return orConditions.length === 1 ? orConditions[0] : { OR: orConditions };
    }

    if (!viewerId) {
      return undefined;
    }

    if (viewerType === 'supplier') {
      return {
        OR: [
          { supplierId: viewerId },
          {
            supplierRequests: {
              some: {
                supplierId: viewerId,
              },
            },
          },
        ],
      };
    }

    if (viewerType === 'manager') {
      return {
        OR: [
          {
            conversationMode: {
              not: 'direct_supplier',
            },
          },
          {
            conversationMode: 'direct_supplier',
            assignedManagerId: viewerId,
          },
        ],
      };
    }

    return undefined;
  }

  private normalizeContactValue(
    type: ContactType,
    rawValue: string,
  ): ResolvedContactValue {
    const trimmedValue = rawValue?.trim();

    if (!trimmedValue) {
      throw new BadRequestException('Contact value is required');
    }

    if (type === 'email') {
      const normalizedValue = trimmedValue.toLowerCase();
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailPattern.test(normalizedValue)) {
        throw new BadRequestException('Некорректный email');
      }

      return {
        value: normalizedValue,
        normalizedValue,
      };
    }

    const sanitizedValue = trimmedValue.replace(/[^\d+()\s-]/g, '');
    const normalizedValue = sanitizedValue.replace(/[^\d+]/g, '');
    const digitsCount = normalizedValue.replace(/\D/g, '').length;

    if (digitsCount < 5) {
      throw new BadRequestException('Некорректный телефон');
    }

    return {
      value: sanitizedValue,
      normalizedValue,
    };
  }

  private buildProfileContactId(profileId: string, type: ContactType) {
    return `profile:${profileId}:${type}`;
  }

  private normalizeEmailForMatching(value?: string | null) {
    return value?.trim().toLowerCase() || '';
  }

  private normalizeTradePointForMatching(value?: string | null) {
    return value?.trim().replace(/\s+/g, ' ').toLowerCase() || '';
  }

  private buildDirectSupplierDialogTitle(supplierName: string) {
    return `Поставщик: ${supplierName}`;
  }

  private async findExistingTicketByTradePointAndEmail(
    tradePointName?: string | null,
    email?: string | null,
  ) {
    const normalizedTradePointName =
      this.normalizeTradePointForMatching(tradePointName);
    const normalizedEmail = this.normalizeEmailForMatching(email);

    if (!normalizedTradePointName || !normalizedEmail) {
      return null;
    }

    const tickets = await this.prisma.ticket.findMany({
      where: {
        tradePointName: {
          not: null,
        },
      },
      select: {
        id: true,
        status: true,
        tradePointName: true,
        canonicalEmail: true,
        clientEmail: true,
        currentUserEmail: true,
        superuserEmail: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    const matchedTicket = tickets.find((ticket) => {
      if (
        this.normalizeTradePointForMatching(ticket.tradePointName) !==
        normalizedTradePointName
      ) {
        return false;
      }

      const ticketEmails = [
        ticket.canonicalEmail,
        ticket.clientEmail,
        ticket.currentUserEmail,
        ticket.superuserEmail,
      ]
        .map((candidate) => this.normalizeEmailForMatching(candidate))
        .filter(Boolean);

      return ticketEmails.includes(normalizedEmail);
    });

    return matchedTicket ?? null;
  }

  private parseProfileContactId(
    contactId: string,
  ): { profileId: string; type: ContactType } | null {
    const [scope, profileId, type] = contactId.split(':');

    if (
      scope !== 'profile' ||
      !profileId ||
      (type !== 'email' && type !== 'phone')
    ) {
      return null;
    }

    return {
      profileId,
      type,
    };
  }

  private normalizeClientVisualIdentityKey(
    ...values: Array<string | null | undefined>
  ) {
    const sourceValue = values.find((value) => value?.trim())?.trim();

    if (!sourceValue) {
      return '';
    }

    return sourceValue.toLowerCase().replace(/\s+/g, ' ');
  }

  private getClientVisualIdentityDisplayName(
    ...values: Array<string | null | undefined>
  ) {
    return values.find((value) => value?.trim())?.trim() ?? null;
  }

  private async ensureClientVisualIdentity(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    clientKey: string,
    displayName: string | null,
  ) {
    if (!clientKey) {
      return {
        avatarColor: null,
        avatarEmoji: null,
      };
    }

    const existingIdentity = await tx.clientVisualIdentity.findUnique({
      where: { key: clientKey },
    });

    if (existingIdentity) {
      if (displayName && existingIdentity.displayName !== displayName) {
        await tx.clientVisualIdentity.update({
          where: { key: clientKey },
          data: { displayName },
        });
      }

      return {
        avatarColor: existingIdentity.avatarColor,
        avatarEmoji: existingIdentity.avatarEmoji,
      };
    }

    const usedPairs = await tx.clientVisualIdentity.findMany({
      select: {
        avatarColor: true,
        avatarEmoji: true,
      },
    });
    const usedPairKeys = new Set(
      usedPairs.map(
        ({ avatarColor, avatarEmoji }) => `${avatarColor}::${avatarEmoji}`,
      ),
    );

    let avatarColor = '';
    let avatarEmoji = '';

    for (const color of CLIENT_AVATAR_COLORS) {
      for (const emoji of CLIENT_AVATAR_EMOJIS) {
        const pairKey = `${color}::${emoji}`;

        if (!usedPairKeys.has(pairKey)) {
          avatarColor = color;
          avatarEmoji = emoji;
          break;
        }
      }

      if (avatarColor && avatarEmoji) {
        break;
      }
    }

    if (!avatarColor || !avatarEmoji) {
      const fallbackIndex = usedPairs.length;
      avatarColor = `hsl(${(fallbackIndex * 47) % 360} 72% 56%)`;
      avatarEmoji =
        CLIENT_AVATAR_EMOJIS[fallbackIndex % CLIENT_AVATAR_EMOJIS.length];
    }

    await tx.clientVisualIdentity.create({
      data: {
        key: clientKey,
        displayName,
        avatarColor,
        avatarEmoji,
      },
    });

    return {
      avatarColor,
      avatarEmoji,
    };
  }

  private async getTicketWithContactsContext(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        clientId: true,
        clientName: true,
        tradePointExternalId: true,
        tradePointName: true,
        clientEmail: true,
        clientPhone: true,
        currentUserId: true,
        currentUserEmail: true,
        currentUserPhone: true,
        currentUserXmlId: true,
        isSuperuser: true,
        superuserId: true,
        superuserEmail: true,
        superuserPhone: true,
        canonicalEmail: true,
        canonicalEmailSource: true,
        lockedBySuperuser: true,
        supplierId: true,
        clientProfile: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
        supplierProfile: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${ticketId}" not found`);
    }

    return ticket;
  }

  private async assertManagerContactAccess(
    ticketId: string,
    managerId?: string,
    managerName?: string,
  ) {
    const normalizedManagerId = managerId?.trim();
    const normalizedManagerName = managerName?.trim();

    if (!normalizedManagerId || !normalizedManagerName) {
      throw new BadRequestException('managerId and managerName are required');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        assignedManagerId: true,
        invitedManagerIds: true,
        lastResolvedByManagerId: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${ticketId}" not found`);
    }

    const invitedManagerIds = readJsonStringArray(ticket.invitedManagerIds);
    const hasAccess =
      ticket.assignedManagerId === null ||
      ticket.assignedManagerId === normalizedManagerId ||
      invitedManagerIds.includes(normalizedManagerId) ||
      ticket.lastResolvedByManagerId === normalizedManagerId;

    if (!hasAccess) {
      throw new ConflictException(
        'Менеджер не может изменять контакты этого диалога',
      );
    }

    await this.profilesService.ensureProfile({
      id: normalizedManagerId,
      fullName: normalizedManagerName,
      role: 'manager',
    });

    return {
      managerId: normalizedManagerId,
      managerName: normalizedManagerName,
    };
  }

  private normalizePageViewString(value?: string | null) {
    const trimmedValue = value?.trim();
    return trimmedValue ? trimmedValue : null;
  }

  private resolvePageViewVisitedAt(timestamp?: string) {
    const normalizedTimestamp = this.normalizePageViewString(timestamp);

    if (!normalizedTimestamp) {
      return new Date();
    }

    const parsedDate = new Date(normalizedTimestamp);

    if (Number.isNaN(parsedDate.getTime())) {
      return new Date();
    }

    return parsedDate;
  }

  private formatPageViewItem(pageView: {
    id: string;
    pageUrl: string;
    pagePath: string;
    pageTitle: string | null;
    pageName: string | null;
    routeType: string | null;
    entityId: string | null;
    entityName: string | null;
    referrer: string | null;
    sourceType: string;
    visitedAt: Date;
  }) {
    return {
      id: pageView.id,
      pageUrl: pageView.pageUrl,
      pagePath: pageView.pagePath,
      pageTitle: pageView.pageTitle,
      pageName: pageView.pageName,
      routeType: pageView.routeType,
      entityId: pageView.entityId,
      entityName: pageView.entityName,
      referrer: pageView.referrer,
      sourceType: pageView.sourceType,
      visitedAt: pageView.visitedAt.toISOString(),
    };
  }

  private buildAutoContacts(
    ticket: Awaited<ReturnType<TicketsService['getTicketWithContactsContext']>>,
  ) {
    const contacts: Array<{
      id: string;
      type: ContactType;
      value: string;
      normalizedValue: string;
      label: string | null;
      source: 'profile';
      sourceLabel: string;
      editable: boolean;
    }> = [];

    const resolvedEmail =
      ticket.canonicalEmail?.trim() ||
      ticket.clientEmail?.trim() ||
      ticket.clientProfile?.email?.trim() ||
      '';
    const resolvedPhone =
      ticket.superuserPhone?.trim() ||
      ticket.currentUserPhone?.trim() ||
      ticket.clientPhone?.trim() ||
      ticket.clientProfile?.phone?.trim() ||
      '';
    const emailSourceLabel = ticket.canonicalEmail?.trim()
      ? ticket.canonicalEmailSource === 'superuser'
        ? 'Email суперпользователя'
        : ticket.canonicalEmailSource === 'employee_fallback'
          ? 'Email сотрудника'
          : 'Основной email клиента'
      : ticket.clientEmail?.trim()
        ? 'Из данных клиента'
        : ticket.clientProfile?.email?.trim()
          ? 'Из профиля клиента'
          : null;
    const phoneSourceLabel = ticket.superuserPhone?.trim()
      ? 'Телефон суперпользователя'
      : ticket.currentUserPhone?.trim()
        ? 'Телефон текущего пользователя'
        : ticket.clientPhone?.trim()
          ? 'Из данных клиента'
          : ticket.clientProfile?.phone?.trim()
            ? 'Из профиля клиента'
            : null;

    if (resolvedEmail && emailSourceLabel) {
      const normalizedEmail = this.normalizeContactValue(
        'email',
        resolvedEmail,
      );
      contacts.push({
        id: ticket.clientProfile?.id
          ? this.buildProfileContactId(ticket.clientProfile.id, 'email')
          : `ticket:${ticket.id}:email`,
        type: 'email',
        value: normalizedEmail.value,
        normalizedValue: normalizedEmail.normalizedValue,
        label: null,
        source: 'profile',
        sourceLabel: emailSourceLabel,
        editable: false,
      });
    }

    if (resolvedPhone && phoneSourceLabel) {
      const normalizedPhone = this.normalizeContactValue(
        'phone',
        resolvedPhone,
      );
      contacts.push({
        id: ticket.clientProfile?.id
          ? this.buildProfileContactId(ticket.clientProfile.id, 'phone')
          : `ticket:${ticket.id}:phone`,
        type: 'phone',
        value: normalizedPhone.value,
        normalizedValue: normalizedPhone.normalizedValue,
        label: null,
        source: 'profile',
        sourceLabel: phoneSourceLabel,
        editable: false,
      });
    }

    return contacts;
  }

  async getContacts(ticketId: string, viewer?: TicketViewer) {
    const ticket = await this.getTicketWithContactsContext(ticketId);

    const ticketWhere = this.buildTicketWhere(viewer);

    if (ticketWhere) {
      const accessibleTicket = await this.prisma.ticket.findFirst({
        where: {
          id: ticketId,
          ...ticketWhere,
        },
        select: {
          id: true,
        },
      });

      if (!accessibleTicket) {
        throw new NotFoundException(`Ticket with id "${ticketId}" not found`);
      }
    }

    const manualContacts = await this.prisma.ticketContact.findMany({
      where: {
        ticketId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const dedupeKeys = new Set<string>();
    const autoContacts = this.buildAutoContacts(ticket).filter((contact) => {
      const dedupeKey = `${contact.type}:${contact.normalizedValue}`;

      if (dedupeKeys.has(dedupeKey)) {
        return false;
      }

      dedupeKeys.add(dedupeKey);
      return true;
    });
    const manualContactItems = manualContacts
      .filter((contact) => {
        const dedupeKey = `${contact.type}:${contact.normalizedValue}`;

        if (dedupeKeys.has(dedupeKey)) {
          return false;
        }

        dedupeKeys.add(dedupeKey);
        return true;
      })
      .map((contact) => ({
        id: contact.id,
        type: contact.type as ContactType,
        value: contact.value,
        normalizedValue: contact.normalizedValue,
        label: contact.label,
        source: 'manual' as const,
        sourceLabel: 'Добавлено вручную',
        editable: true,
      }));

    return {
      items: [...autoContacts, ...manualContactItems],
    };
  }

  async getPageViews(ticketId: string, viewer?: TicketViewer) {
    const ticketWhere = this.buildTicketWhere(viewer);

    if (ticketWhere) {
      const accessibleTicket = await this.prisma.ticket.findFirst({
        where: {
          id: ticketId,
          ...ticketWhere,
        },
        select: {
          id: true,
        },
      });

      if (!accessibleTicket) {
        throw new NotFoundException(`Ticket with id "${ticketId}" not found`);
      }
    }

    const pageViews = await this.prisma.ticketPageView.findMany({
      where: {
        ticketId,
      },
      orderBy: {
        visitedAt: 'desc',
      },
      take: 10,
    });

    return {
      current: pageViews[0] ? this.formatPageViewItem(pageViews[0]) : null,
      items: pageViews.map((pageView) => this.formatPageViewItem(pageView)),
    };
  }

  async recordPageView(payload: TicketPageViewPayload) {
    const tradePointId = this.normalizePageViewString(payload.tradePointId);
    const pageUrl = this.normalizePageViewString(payload.pageUrl);
    const pagePath = this.normalizePageViewString(payload.pagePath);
    const pageTitle = this.normalizePageViewString(payload.pageTitle);

    if (!tradePointId || !pageUrl || !pagePath) {
      throw new BadRequestException(
        'tradePointId, pageUrl and pagePath are required',
      );
    }

    const ticket = await this.prisma.ticket.findFirst({
      where: {
        clientId: tradePointId,
      },
      orderBy: [
        { resolvedAt: 'asc' },
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      select: {
        id: true,
        clientId: true,
        tradePointName: true,
        lastMessageAt: true,
      },
    });

    if (!ticket) {
      return {
        recorded: false,
        reason: 'ticket_not_found',
      };
    }

    const lastPageView = await this.prisma.ticketPageView.findFirst({
      where: {
        ticketId: ticket.id,
      },
      orderBy: {
        visitedAt: 'desc',
      },
      select: {
        pagePath: true,
        pageTitle: true,
        visitedAt: true,
      },
    });

    const visitedAt = this.resolvePageViewVisitedAt(payload.timestamp);

    if (
      lastPageView &&
      lastPageView.pagePath === pagePath &&
      (lastPageView.pageTitle ?? null) === pageTitle &&
      visitedAt.getTime() - lastPageView.visitedAt.getTime() <= 3000
    ) {
      return {
        recorded: false,
        reason: 'duplicate',
      };
    }

    const savedPageView = await this.prisma.ticketPageView.create({
      data: {
        ticketId: ticket.id,
        tradePointId,
        pageUrl,
        pagePath,
        pageTitle,
        pageName: this.normalizePageViewString(payload.pageName),
        routeType: this.normalizePageViewString(payload.routeType),
        entityId: this.normalizePageViewString(payload.entityId),
        entityName: this.normalizePageViewString(payload.entityName),
        referrer: this.normalizePageViewString(payload.referrer),
        sourceType:
          this.normalizePageViewString(payload.sourceType) ?? 'page_view',
        visitedAt,
      },
    });

    const tradePointName = this.normalizePageViewString(payload.tradePointName);

    if (tradePointName && tradePointName !== ticket.tradePointName) {
      await this.prisma.ticket.update({
        where: {
          id: ticket.id,
        },
        data: {
          tradePointName,
        },
      });
    }

    return {
      recorded: true,
      ticketId: ticket.id,
      current: this.formatPageViewItem(savedPageView),
    };
  }

  async addContact(
    ticketId: string,
    managerId: string,
    managerName: string,
    type: ContactType,
    value: string,
    label?: string | null,
  ) {
    const manager = await this.assertManagerContactAccess(
      ticketId,
      managerId,
      managerName,
    );
    const resolvedValue = this.normalizeContactValue(type, value);

    await this.prisma.ticketContact.create({
      data: {
        ticketId,
        type,
        value: resolvedValue.value,
        normalizedValue: resolvedValue.normalizedValue,
        label: label?.trim() || null,
        createdByProfileId: manager.managerId,
      },
    });

    return this.getContacts(ticketId, {
      viewerType: 'manager',
      viewerId: manager.managerId,
    });
  }

  async updateContact(
    ticketId: string,
    contactId: string,
    managerId: string,
    managerName: string,
    type?: ContactType,
    value?: string,
    label?: string | null,
  ) {
    const manager = await this.assertManagerContactAccess(
      ticketId,
      managerId,
      managerName,
    );
    const profileContact = this.parseProfileContactId(contactId);

    if (profileContact) {
      const ticket = await this.getTicketWithContactsContext(ticketId);
      const primaryProfile =
        ticket.clientProfile?.id === profileContact.profileId
          ? ticket.clientProfile
          : ticket.supplierProfile?.id === profileContact.profileId
            ? ticket.supplierProfile
            : null;

      if (!primaryProfile) {
        throw new NotFoundException(`Contact with id "${contactId}" not found`);
      }

      const nextType = type ?? profileContact.type;

      if (!value?.trim()) {
        throw new BadRequestException('Contact value is required');
      }

      if (nextType !== profileContact.type) {
        throw new BadRequestException('Нельзя менять тип контакта профиля');
      }

      const resolvedValue = this.normalizeContactValue(nextType, value);

      await this.prisma.profile.update({
        where: {
          id: primaryProfile.id,
        },
        data:
          nextType === 'email'
            ? {
                email: resolvedValue.value,
              }
            : {
                phone: resolvedValue.value,
              },
      });

      return this.getContacts(ticketId, {
        viewerType: 'manager',
        viewerId: manager.managerId,
      });
    }

    const existingContact = await this.prisma.ticketContact.findFirst({
      where: {
        id: contactId,
        ticketId,
      },
      select: {
        id: true,
        type: true,
        value: true,
      },
    });

    if (!existingContact) {
      throw new NotFoundException(`Contact with id "${contactId}" not found`);
    }

    const nextType = (type ?? existingContact.type) as ContactType;
    const updateData: Record<string, unknown> = {};

    if (type) {
      updateData.type = nextType;
    }

    if (typeof label === 'string') {
      updateData.label = label.trim() || null;
    }

    if (typeof value === 'string') {
      const resolvedValue = this.normalizeContactValue(nextType, value);
      updateData.value = resolvedValue.value;
      updateData.normalizedValue = resolvedValue.normalizedValue;
    }

    if (Object.keys(updateData).length === 0) {
      return this.getContacts(ticketId, {
        viewerType: 'manager',
        viewerId: manager.managerId,
      });
    }

    if (type && typeof value !== 'string') {
      const resolvedValue = this.normalizeContactValue(
        nextType,
        existingContact.value,
      );
      updateData.value = resolvedValue.value;
      updateData.normalizedValue = resolvedValue.normalizedValue;
    }

    await this.prisma.ticketContact.update({
      where: {
        id: contactId,
      },
      data: updateData,
    });

    return this.getContacts(ticketId, {
      viewerType: 'manager',
      viewerId: manager.managerId,
    });
  }

  async deleteContact(
    ticketId: string,
    contactId: string,
    managerId: string,
    managerName: string,
  ) {
    const manager = await this.assertManagerContactAccess(
      ticketId,
      managerId,
      managerName,
    );
    const profileContact = this.parseProfileContactId(contactId);

    if (profileContact) {
      const ticket = await this.getTicketWithContactsContext(ticketId);
      const primaryProfile =
        ticket.clientProfile?.id === profileContact.profileId
          ? ticket.clientProfile
          : ticket.supplierProfile?.id === profileContact.profileId
            ? ticket.supplierProfile
            : null;

      if (!primaryProfile) {
        throw new NotFoundException(`Contact with id "${contactId}" not found`);
      }

      await this.prisma.profile.update({
        where: {
          id: primaryProfile.id,
        },
        data:
          profileContact.type === 'email'
            ? {
                email: null,
              }
            : {
                phone: null,
              },
      });

      return this.getContacts(ticketId, {
        viewerType: 'manager',
        viewerId: manager.managerId,
      });
    }

    const existingContact = await this.prisma.ticketContact.findFirst({
      where: {
        id: contactId,
        ticketId,
      },
      select: {
        id: true,
      },
    });

    if (!existingContact) {
      throw new NotFoundException(`Contact with id "${contactId}" not found`);
    }

    await this.prisma.ticketContact.delete({
      where: {
        id: contactId,
      },
    });

    return this.getContacts(ticketId, {
      viewerType: 'manager',
      viewerId: manager.managerId,
    });
  }

  async create(
    title = 'Тестовый тикет',
    clientId?: string,
    clientName?: string,
  ) {
    const now = new Date();
    const clientVisualIdentityKey = this.normalizeClientVisualIdentityKey(
      clientId,
      clientName,
      title,
    );
    const clientVisualDisplayName = this.getClientVisualIdentityDisplayName(
      clientId,
      clientName,
      title,
    );

    await this.profilesService.ensureProfile({
      id: clientId,
      fullName: clientName,
      role: clientId ? 'client' : null,
    });

    return this.prisma.$transaction(async (tx) => {
      const { avatarColor, avatarEmoji } =
        await this.ensureClientVisualIdentity(
          tx,
          clientVisualIdentityKey,
          clientVisualDisplayName,
        );

      return tx.ticket.create({
        data: {
          title,
          status: 'new',
          conversationMode: 'manager',
          currentHandlerType: 'manager',
          aiEnabled: false,
          aiResolved: false,
          invitedManagerIds: [],
          invitedManagerNames: [],
          assignedManagerId: null,
          assignedManagerName: null,
          lastResolvedByManagerId: null,
          lastResolvedByManagerName: null,
          clientId: clientId ?? null,
          clientName: clientName ?? null,
          clientEmail: null,
          clientPhone: null,
          avatarColor,
          avatarEmoji,
          supplierId: null,
          supplierName: null,
          claimRequiredAt: now,
          claimedAt: null,
          claimMissedAt: null,
          returnedToQueueAt: null,
          lastClientMessageAt: null,
          lastManagerReplyAt: null,
          rescueQueuedAt: null,
          firstResponseStartedAt: now,
          firstResponseAt: null,
          firstResponseTime: null,
          firstResponseBreached: false,
          lastMessageAt: null,
        },
      });
    });
  }

  async createManagerCreatedClient(
    managerId: string,
    managerName: string,
    tradePointName: string,
    clientEmail: string,
    clientPhone?: string,
  ) {
    const normalizedTradePointName = tradePointName?.trim();

    if (!normalizedTradePointName) {
      throw new BadRequestException('Торговая точка обязательна');
    }

    const resolvedEmail = this.normalizeContactValue('email', clientEmail);
    const resolvedPhone = clientPhone?.trim()
      ? this.normalizeContactValue('phone', clientPhone)
      : null;

    await this.profilesService.ensureProfile({
      id: managerId?.trim(),
      fullName: managerName?.trim(),
      role: 'manager',
    });

    const existingTicket = await this.findExistingTicketByTradePointAndEmail(
      normalizedTradePointName,
      resolvedEmail.value,
    );

    if (existingTicket) {
      return this.prisma.ticket.findUnique({
        where: { id: existingTicket.id },
      });
    }

    const now = new Date();
    const clientContext = resolveTicketClientContext({
      clientName: normalizedTradePointName,
      tradePointName: normalizedTradePointName,
      canonicalEmail: resolvedEmail.value,
      canonicalEmailSource: 'manual',
      clientEmail: resolvedEmail.value,
      clientPhone: resolvedPhone?.value,
    });
    const clientVisualIdentityKey = this.normalizeClientVisualIdentityKey(
      normalizedTradePointName,
      resolvedEmail.value,
    );
    const clientVisualDisplayName = this.getClientVisualIdentityDisplayName(
      normalizedTradePointName,
    );

    return this.prisma.$transaction(async (tx) => {
      const { avatarColor, avatarEmoji } =
        await this.ensureClientVisualIdentity(
          tx,
          clientVisualIdentityKey,
          clientVisualDisplayName,
        );

      const ticket = await tx.ticket.create({
        data: {
          title: normalizedTradePointName,
          status: 'in_progress',
          conversationMode: 'manager',
          currentHandlerType: 'manager',
          aiEnabled: false,
          aiResolved: false,
          invitedManagerIds: [],
          invitedManagerNames: [],
          assignedManagerId: managerId.trim(),
          assignedManagerName: managerName.trim(),
          lastResolvedByManagerId: null,
          lastResolvedByManagerName: null,
          clientId: clientContext.clientId,
          clientName: clientContext.clientName,
          tradePointExternalId: clientContext.tradePointExternalId,
          tradePointName: clientContext.tradePointName,
          clientEmail: clientContext.clientEmail,
          clientPhone: clientContext.clientPhone,
          currentUserId: clientContext.currentUserId,
          currentUserEmail: clientContext.currentUserEmail,
          currentUserPhone: clientContext.currentUserPhone,
          currentUserXmlId: clientContext.currentUserXmlId,
          isSuperuser: clientContext.isSuperuser,
          superuserId: clientContext.superuserId,
          superuserEmail: clientContext.superuserEmail,
          superuserPhone: clientContext.superuserPhone,
          canonicalEmail: clientContext.canonicalEmail,
          canonicalEmailSource: clientContext.canonicalEmailSource,
          lockedBySuperuser: clientContext.lockedBySuperuser,
          avatarColor,
          avatarEmoji,
          supplierId: null,
          supplierName: null,
          claimRequiredAt: null,
          claimedAt: now,
          claimMissedAt: null,
          returnedToQueueAt: null,
          lastClientMessageAt: null,
          lastManagerReplyAt: now,
          rescueQueuedAt: null,
          firstResponseStartedAt: null,
          firstResponseAt: null,
          firstResponseTime: null,
          firstResponseBreached: false,
          lastMessageAt: now,
        },
      });

      await tx.ticketContact.create({
        data: {
          ticketId: ticket.id,
          type: 'email',
          value: resolvedEmail.value,
          normalizedValue: resolvedEmail.normalizedValue,
          label: 'Email',
          createdByProfileId: managerId.trim(),
        },
      });

      if (resolvedPhone) {
        await tx.ticketContact.create({
          data: {
            ticketId: ticket.id,
            type: 'phone',
            value: resolvedPhone.value,
            normalizedValue: resolvedPhone.normalizedValue,
            label: 'Телефон',
            createdByProfileId: managerId.trim(),
          },
        });
      }

      return ticket;
    });
  }

  async createWithFirstMessage(
    title: string,
    firstMessage: string,
    senderType: string,
    senderId?: string,
    senderName?: string,
    clientId?: string,
    clientName?: string,
    tradePointId?: string,
    tradePointExternalId?: string,
    tradePointName?: string,
    currentUserId?: string,
    currentUserEmail?: string,
    currentUserPhone?: string,
    currentUserXmlId?: string,
    isSuperuser?: boolean,
    superuserId?: string,
    superuserEmail?: string,
    superuserPhone?: string,
    canonicalEmail?: string,
    canonicalEmailSource?: string,
    clientEmail?: string,
    clientPhone?: string,
    aiEnabled = false,
  ) {
    const incomingClientContext = resolveTicketClientContext({
      clientId,
      clientName,
      tradePointId,
      tradePointExternalId,
      tradePointName,
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
      clientEmail,
      clientPhone,
    });
    const matchedTicket =
      senderType === 'client'
        ? await this.findExistingTicketByTradePointAndEmail(
            incomingClientContext.tradePointName,
            incomingClientContext.canonicalEmail ??
              incomingClientContext.clientEmail,
          )
        : null;

    const createdTicket = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const isClientStart = senderType === 'client';
      const clientContext = incomingClientContext;
      const normalizedClientId = clientContext.clientId;
      const normalizedClientName = clientContext.clientName;
      const firstResponseTime = senderType === 'manager' ? 0 : null;
      const clientVisualIdentityKey = this.normalizeClientVisualIdentityKey(
        normalizedClientId,
        normalizedClientName,
        title,
      );
      const clientVisualDisplayName = this.getClientVisualIdentityDisplayName(
        normalizedClientId,
        normalizedClientName,
        title,
      );

      await this.profilesService.ensureProfile({
        id: normalizedClientId,
        fullName: normalizedClientName,
        role: normalizedClientId ? 'client' : null,
      });

      if (senderId) {
        await this.profilesService.ensureProfile({
          id: senderId,
          fullName: senderName,
          role: senderType,
        });
      }

      const { avatarColor, avatarEmoji } =
        await this.ensureClientVisualIdentity(
          tx,
          clientVisualIdentityKey,
          clientVisualDisplayName,
        );

      if (matchedTicket?.id && senderType === 'client') {
        const existingTicket = await tx.ticket.findUnique({
          where: { id: matchedTicket.id },
          select: {
            id: true,
            title: true,
            status: true,
            aiEnabled: true,
            firstResponseStartedAt: true,
            assignedManagerId: true,
            clientId: true,
            clientName: true,
            tradePointExternalId: true,
            tradePointName: true,
            clientEmail: true,
            clientPhone: true,
            currentUserId: true,
            currentUserEmail: true,
            currentUserPhone: true,
            currentUserXmlId: true,
            isSuperuser: true,
            superuserId: true,
            superuserEmail: true,
            superuserPhone: true,
            canonicalEmail: true,
            canonicalEmailSource: true,
            lockedBySuperuser: true,
          },
        });

        if (!existingTicket) {
          throw new NotFoundException(
            `Ticket with id "${matchedTicket.id}" not found`,
          );
        }

        const isReopened =
          existingTicket.status === 'resolved' ||
          existingTicket.status === 'closed';

        if (isReopened) {
          await tx.ticket.update({
            where: { id: existingTicket.id },
            data: {
              status: 'new',
              requestCount: {
                increment: 1,
              },
              assignedManagerId: null,
              assignedManagerName: null,
              claimRequiredAt: now,
              claimedAt: null,
              claimMissedAt: null,
              returnedToQueueAt: null,
              lastClientMessageAt: now,
              lastManagerReplyAt: null,
              rescueQueuedAt: null,
              handedToManagerAt: null,
              conversationMode: 'manager',
              currentHandlerType: 'manager',
              aiEnabled: false,
              firstResponseStartedAt: now,
              firstResponseAt: null,
              firstResponseTime: null,
              firstResponseBreached: false,
              managerRating: null,
              managerRatingSubmittedAt: null,
              resolvedAt: null,
              closedAt: null,
              lastMessageAt: now,
            },
          });
        }

        const message = await tx.message.create({
          data: {
            ticketId: existingTicket.id,
            content: firstMessage,
            senderType,
            senderRole: senderType,
            senderProfileId: senderId ?? null,
            status: 'sent',
            deliveryStatus: 'sent',
            messageType: 'text',
          },
        });

        const mergedClientContext = resolveTicketClientContext(
          {
            clientId,
            clientName,
            tradePointId,
            tradePointExternalId,
            tradePointName,
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
            clientEmail,
            clientPhone,
          },
          existingTicket,
        );

        await tx.ticket.update({
          where: { id: existingTicket.id },
          data: {
            title: existingTicket.title || normalizedClientName || title,
            status: 'new',
            clientId: mergedClientContext.clientId ?? existingTicket.clientId,
            clientName:
              mergedClientContext.clientName ?? existingTicket.clientName,
            tradePointExternalId: mergedClientContext.tradePointExternalId,
            tradePointName:
              mergedClientContext.tradePointName ??
              existingTicket.tradePointName,
            clientEmail: mergedClientContext.clientEmail,
            clientPhone: mergedClientContext.clientPhone,
            currentUserId: mergedClientContext.currentUserId,
            currentUserEmail: mergedClientContext.currentUserEmail,
            currentUserPhone: mergedClientContext.currentUserPhone,
            currentUserXmlId: mergedClientContext.currentUserXmlId,
            isSuperuser: mergedClientContext.isSuperuser,
            superuserId: mergedClientContext.superuserId,
            superuserEmail: mergedClientContext.superuserEmail,
            superuserPhone: mergedClientContext.superuserPhone,
            canonicalEmail: mergedClientContext.canonicalEmail,
            canonicalEmailSource: mergedClientContext.canonicalEmailSource,
            lockedBySuperuser: mergedClientContext.lockedBySuperuser,
            avatarColor,
            avatarEmoji,
            lastMessageAt: message.createdAt,
            closedAt: null,
          },
        });

        await this.maybeCreateOfflineManagerAutoReply(
          tx,
          existingTicket.id,
          message.createdAt,
        );

        return {
          id: existingTicket.id,
        };
      }

      const ticket = await tx.ticket.create({
        data: {
          title,
          status: isClientStart ? 'new' : 'in_progress',
          conversationMode: aiEnabled ? 'ai' : 'manager',
          currentHandlerType: aiEnabled ? 'ai' : 'manager',
          aiEnabled,
          aiActivatedAt: aiEnabled ? now : null,
          aiResolved: false,
          invitedManagerIds: [],
          invitedManagerNames: [],
          assignedManagerId: null,
          assignedManagerName: null,
          lastResolvedByManagerId: null,
          lastResolvedByManagerName: null,
          clientId: normalizedClientId,
          clientName: normalizedClientName,
          tradePointExternalId: clientContext.tradePointExternalId,
          tradePointName: clientContext.tradePointName,
          clientEmail: clientContext.clientEmail,
          clientPhone: clientContext.clientPhone,
          currentUserId: clientContext.currentUserId,
          currentUserEmail: clientContext.currentUserEmail,
          currentUserPhone: clientContext.currentUserPhone,
          currentUserXmlId: clientContext.currentUserXmlId,
          isSuperuser: clientContext.isSuperuser,
          superuserId: clientContext.superuserId,
          superuserEmail: clientContext.superuserEmail,
          superuserPhone: clientContext.superuserPhone,
          canonicalEmail: clientContext.canonicalEmail,
          canonicalEmailSource: clientContext.canonicalEmailSource,
          lockedBySuperuser: clientContext.lockedBySuperuser,
          avatarColor,
          avatarEmoji,
          supplierId: senderType === 'supplier' ? (senderId ?? null) : null,
          supplierName: senderType === 'supplier' ? (senderName ?? null) : null,
          firstResponseStartedAt: isClientStart ? now : null,
          firstResponseAt: senderType === 'manager' ? now : null,
          firstResponseTime,
          firstResponseBreached: false,
          lastMessageAt: now,
        },
      });

      const message = await tx.message.create({
        data: {
          ticketId: ticket.id,
          content: firstMessage,
          senderType,
          senderRole: senderType,
          senderProfileId: senderId ?? null,
          status: 'sent',
          deliveryStatus: 'sent',
          messageType: 'text',
        },
      });

      if (aiEnabled) {
        await this.createSystemMessage(
          tx,
          ticket.id,
          'AI-помощник подключён к диалогу',
        );
      }

      if (isClientStart) {
        await this.maybeCreateOfflineManagerAutoReply(
          tx,
          ticket.id,
          message.createdAt,
        );
      }

      return {
        ...ticket,
        messages: [message],
      };
    });

    if (aiEnabled) {
      void this.chatAiService.persistAiTurn(createdTicket.id).catch((error) => {
        console.error('Ошибка AI-ответа в createWithFirstMessage:', error);
      });
    }

    return this.prisma.ticket.findUnique({
      where: { id: createdTicket.id },
    });
  }

  async findAll(viewer?: TicketViewer) {
    const ticketWhere = this.buildTicketWhere(viewer);
    const viewerType = viewer?.viewerType?.trim();

    if (viewerType === 'client' || viewerType === 'supplier') {
      return this.prisma.ticket.findMany({
        where: ticketWhere,
        select: {
          id: true,
          title: true,
          status: true,
          pinned: true,
          aiEnabled: true,
          currentHandlerType: true,
          conversationMode: true,
          lastResolvedByRole: true,
          lastResolvedByManagerName: true,
          managerRating: true,
          managerRatingSubmittedAt: true,
          clientId: true,
          clientName: true,
          lastMessageAt: true,
          resolvedAt: true,
          closedAt: true,
          tradePointName: true,
          clientEmail: true,
          clientPhone: true,
          currentUserEmail: true,
          currentUserPhone: true,
          superuserEmail: true,
          superuserPhone: true,
          canonicalEmail: true,
          avatarColor: true,
          avatarEmoji: true,
          assignedManagerId: true,
          assignedManagerName: true,
          invitedManagerNames: true,
        },
        orderBy: [
          { pinned: 'desc' },
          { lastMessageAt: 'desc' },
          { updatedAt: 'desc' },
        ],
      });
    }

    return this.prisma.ticket.findMany({
      where: ticketWhere,
      include: {
        messages: {
          select: {
            id: true,
            content: true,
            senderType: true,
            replyToMessageId: true,
            replyToContent: true,
            messageType: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        pageViews: {
          select: {
            id: true,
            pageUrl: true,
            pagePath: true,
            pageTitle: true,
            pageName: true,
            routeType: true,
            entityId: true,
            entityName: true,
            referrer: true,
            sourceType: true,
            visitedAt: true,
          },
          orderBy: { visitedAt: 'asc' },
        },
      },
      orderBy: [
        { pinned: 'desc' },
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' },
      ],
    });
  }

  async findOrCreateManagerSupplierDialogs(
    managerId?: string,
    managerName?: string,
  ) {
    const normalizedManagerId = managerId?.trim();
    const normalizedManagerName = managerName?.trim();

    if (!normalizedManagerId || !normalizedManagerName) {
      throw new BadRequestException('managerId and managerName are required');
    }

    await this.profilesService.ensureProfile({
      id: normalizedManagerId,
      fullName: normalizedManagerName,
      role: 'manager',
    });

    const suppliers = await this.prisma.profile.findMany({
      where: {
        role: 'supplier_supervisor',
        isActive: true,
        approvalStatus: {
          not: 'rejected',
        },
        companyName: {
          not: null,
        },
      },
      orderBy: [{ companyName: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        companyName: true,
        supplierId: true,
        fullName: true,
      },
    });

    const seenSupplierScopes = new Set<string>();
    const supplierScopes = suppliers
      .map((supplier) => {
        const supplierName = supplier.companyName?.trim();
        const supplierScopeId = supplier.supplierId?.trim() || supplier.id;

        if (!supplierName || seenSupplierScopes.has(supplierScopeId)) {
          return null;
        }

        seenSupplierScopes.add(supplierScopeId);

        return {
          supplierId: supplierScopeId,
          supplierName,
        };
      })
      .filter(
        (supplier): supplier is { supplierId: string; supplierName: string } =>
          Boolean(supplier),
      );

    await this.prisma.$transaction(async (tx) => {
      for (const supplier of supplierScopes) {
        const existingDialog = await tx.ticket.findFirst({
          where: {
            conversationMode: 'direct_supplier',
            assignedManagerId: normalizedManagerId,
            supplierId: supplier.supplierId,
          },
          select: {
            id: true,
          },
        });

        if (existingDialog) {
          continue;
        }

        await tx.ticket.create({
          data: {
            title: this.buildDirectSupplierDialogTitle(supplier.supplierName),
            status: 'in_progress',
            conversationMode: 'direct_supplier',
            currentHandlerType: 'manager',
            aiEnabled: false,
            aiResolved: false,
            invitedManagerIds: [],
            invitedManagerNames: [],
            assignedManagerId: normalizedManagerId,
            assignedManagerName: normalizedManagerName,
            supplierId: supplier.supplierId,
            supplierName: supplier.supplierName,
            clientId: null,
            clientName: supplier.supplierName,
            tradePointName: supplier.supplierName,
            claimRequiredAt: null,
            claimedAt: new Date(),
            firstResponseStartedAt: null,
            firstResponseAt: null,
            firstResponseTime: null,
            firstResponseBreached: false,
            lastMessageAt: null,
          },
        });
      }
    });

    return this.findDirectSupplierDialogs({
      assignedManagerId: normalizedManagerId,
    });
  }

  async findSupplierManagerDialogs(supplierId?: string) {
    const normalizedSupplierId = supplierId?.trim();

    if (!normalizedSupplierId) {
      throw new BadRequestException('supplierId is required');
    }

    return this.findDirectSupplierDialogs({
      supplierId: normalizedSupplierId,
    });
  }

  private async findDirectSupplierDialogs(where: {
    assignedManagerId?: string;
    supplierId?: string;
  }) {
    const dialogs = await this.prisma.ticket.findMany({
      where: {
        conversationMode: 'direct_supplier',
        ...where,
      },
      include: {
        messages: {
          select: {
            id: true,
            content: true,
            senderType: true,
            senderProfileId: true,
            senderProfile: {
              select: {
                fullName: true,
              },
            },
            replyToMessageId: true,
            replyToContent: true,
            messageType: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    });

    const supplierIds = [
      ...new Set(
        dialogs
          .map((dialog) => dialog.supplierId?.trim())
          .filter((supplierId): supplierId is string => Boolean(supplierId)),
      ),
    ];
    const supplierNames = [
      ...new Set(
        dialogs
          .map((dialog) => dialog.supplierName?.trim())
          .filter((supplierName): supplierName is string =>
            Boolean(supplierName),
          ),
      ),
    ];
    const managerIds = [
      ...new Set(
        dialogs
          .map((dialog) => dialog.assignedManagerId?.trim())
          .filter((managerId): managerId is string => Boolean(managerId)),
      ),
    ];

    const supplierProfiles =
      supplierIds.length > 0 || supplierNames.length > 0
        ? await this.prisma.profile.findMany({
            where: {
              isActive: true,
              approvalStatus: {
                not: 'rejected',
              },
              role: {
                in: ['supplier', 'supplier_supervisor'],
              },
              OR: [
                ...(supplierIds.length > 0
                  ? [
                      { id: { in: supplierIds } },
                      { supplierId: { in: supplierIds } },
                    ]
                  : []),
                ...(supplierNames.length > 0
                  ? [{ companyName: { in: supplierNames } }]
                  : []),
              ],
            },
            select: {
              id: true,
              supplierId: true,
              companyName: true,
              fullName: true,
              role: true,
              createdAt: true,
            },
            orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
          })
        : [];
    const managerProfiles =
      managerIds.length > 0
        ? await this.prisma.profile.findMany({
            where: {
              id: {
                in: managerIds,
              },
              isActive: true,
              role: {
                in: ['manager', 'manager_supervisor'],
              },
            },
            select: {
              id: true,
              fullName: true,
            },
          })
        : [];

    const profilesBySupplierScope = new Map<
      string,
      (typeof supplierProfiles)[number]
    >();
    const profilesByCompanyName = new Map<
      string,
      (typeof supplierProfiles)[number]
    >();
    const managerProfilesById = new Map(
      managerProfiles.map((profile) => [profile.id, profile]),
    );

    for (const profile of supplierProfiles) {
      const scopeKeys = [profile.supplierId?.trim(), profile.id.trim()].filter(
        (scopeKey): scopeKey is string => Boolean(scopeKey),
      );

      for (const scopeKey of scopeKeys) {
        if (!profilesBySupplierScope.has(scopeKey)) {
          profilesBySupplierScope.set(scopeKey, profile);
        }
      }

      const companyName = profile.companyName?.trim();

      const existingCompanyProfile = companyName
        ? profilesByCompanyName.get(companyName)
        : null;

      if (
        companyName &&
        (!existingCompanyProfile ||
          (!isSpecificSupplierContactName(
            existingCompanyProfile.fullName,
            companyName,
          ) &&
            isSpecificSupplierContactName(profile.fullName, companyName)))
      ) {
        profilesByCompanyName.set(companyName, profile);
      }
    }

    return dialogs.map((dialog) => {
      const lastSupplierMessage = [...dialog.messages]
        .reverse()
        .find(
          (message) =>
            message.senderType === 'supplier' &&
            message.senderProfile?.fullName?.trim(),
        );
      const supplierProfile =
        (dialog.supplierId
          ? profilesBySupplierScope.get(dialog.supplierId)
          : null) ??
        (dialog.supplierName
          ? profilesByCompanyName.get(dialog.supplierName)
          : null);
      const supplierCompanyName =
        dialog.supplierName?.trim() ||
        supplierProfile?.companyName?.trim() ||
        null;
      const supplierProfileName = isSpecificSupplierContactName(
        supplierProfile?.fullName,
        supplierCompanyName,
      )
        ? supplierProfile?.fullName?.trim()
        : null;
      const supplierContactName =
        (isSpecificSupplierContactName(
          lastSupplierMessage?.senderProfile?.fullName,
          supplierCompanyName,
        )
          ? lastSupplierMessage?.senderProfile?.fullName?.trim()
          : null) ||
        supplierProfileName ||
        null;
      const managerProfileName = dialog.assignedManagerId
        ? managerProfilesById.get(dialog.assignedManagerId)?.fullName?.trim()
        : null;
      const assignedManagerName =
        (isSpecificManagerName(dialog.assignedManagerName)
          ? dialog.assignedManagerName?.trim()
          : null) ||
        managerProfileName ||
        dialog.assignedManagerName?.trim() ||
        null;

      return {
        ...dialog,
        messages: dialog.messages.map(({ senderProfile, ...message }) => ({
          ...message,
          senderName: senderProfile?.fullName?.trim() || null,
        })),
        assignedManagerName,
        supplierCompanyName,
        supplierContactName,
      };
    });
  }

  async updateTyping(id: string, senderType: string, previewText?: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    this.typingService.setTyping(id, senderType, previewText);

    return {
      ok: true,
    };
  }

  async getTyping(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    return this.typingService.getTyping(id);
  }

  async togglePinned(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { id: true, pinned: true },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    if (!ticket.pinned) {
      const pinnedTicketsCount = await this.prisma.ticket.count({
        where: { pinned: true },
      });

      if (pinnedTicketsCount >= 3) {
        throw new BadRequestException('Можно закрепить максимум 3 чата');
      }
    }

    return this.prisma.ticket.update({
      where: { id },
      data: {
        pinned: !ticket.pinned,
      },
    });
  }

  async resolve(id: string, resolveTicketDto: ResolveTicketDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    await this.profilesService.ensureProfile({
      id: resolveTicketDto.managerId,
      fullName: resolveTicketDto.managerName,
      role: 'manager',
    });

    if (resolveTicketDto.resolverRole === 'supplier') {
      throw new BadRequestException(
        'Поставщик не может завершать весь диалог. Сначала закройте запрос поставщика.',
      );
    }

    const activeSupplierRequests = await this.prisma.supplierRequest.findMany({
      where: {
        ticketId: id,
        status: {
          notIn: ['closed', 'cancelled', 'resolved'],
        },
      },
      select: {
        id: true,
        supplierName: true,
      },
    });

    if (
      activeSupplierRequests.length > 0 &&
      !resolveTicketDto.forceCloseSupplierRequests
    ) {
      throw new BadRequestException(
        'Нельзя завершить диалог, пока поставщик не отметил запрос как решённый',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      if (activeSupplierRequests.length > 0) {
        await tx.supplierRequest.updateMany({
          where: {
            id: {
              in: activeSupplierRequests.map((request) => request.id),
            },
          },
          data: {
            status: 'closed',
            lastSupplierReplyAt: now,
            closedAt: now,
          },
        });

        await Promise.all(
          activeSupplierRequests.map((request) =>
            tx.message.create({
              data: {
                ticketId: id,
                content: `Менеджер ${resolveTicketDto.managerName} завершил чат поставщика ${request.supplierName}`,
                senderType: 'system',
                senderRole: 'system',
                status: 'sent',
                deliveryStatus: 'sent',
                messageType: 'system',
              },
            }),
          ),
        );
      }

      const updatedTicket = await tx.ticket.update({
        where: { id },
        data: {
          status: 'resolved',
          assignedManagerId: null,
          assignedManagerName: null,
          lastResolvedByManagerId: resolveTicketDto.managerId,
          lastResolvedByManagerName: resolveTicketDto.managerName,
          lastResolvedByRole: resolveTicketDto.resolverRole ?? 'manager',
          managerRating: null,
          managerRatingSubmittedAt: null,
          resolvedAt: now,
          closedAt: now,
        },
      });

      await tx.ticket.update({
        where: { id },
        data: {
          lastMessageAt: now,
        },
      });

      return updatedTicket;
    });
  }

  async reopen(id: string, assignManagerDto: AssignManagerDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    await this.profilesService.ensureProfile({
      id: assignManagerDto.managerId,
      fullName: assignManagerDto.managerName,
      role: 'manager',
    });

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const updatedTicket = await tx.ticket.update({
        where: { id },
        data: {
          status: 'in_progress',
          assignedManagerId: assignManagerDto.managerId,
          assignedManagerName: assignManagerDto.managerName,
          conversationMode: 'manager',
          currentHandlerType: 'manager',
          aiEnabled: false,
          handedToManagerAt: now,
          resolvedAt: null,
          closedAt: null,
        },
      });

      await tx.message.create({
        data: {
          ticketId: id,
          content: `Менеджер ${assignManagerDto.managerName} снова открыл диалог`,
          senderType: 'system',
          senderRole: 'system',
          status: 'sent',
          deliveryStatus: 'sent',
          messageType: 'system',
        },
      });

      await tx.ticket.update({
        where: { id },
        data: {
          lastMessageAt: now,
        },
      });

      return updatedTicket;
    });
  }

  async rateManager(id: string, rating: number) {
    if (![1, 2, 3].includes(rating)) {
      throw new BadRequestException('Оценка должна быть 1, 2 или 3');
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        managerRatingSubmittedAt: true,
        lastResolvedByRole: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    if (ticket.lastResolvedByRole !== 'manager') {
      throw new BadRequestException(
        'Оценка доступна только для диалога, завершённого менеджером',
      );
    }

    if (ticket.managerRatingSubmittedAt) {
      throw new ConflictException('Оценка уже отправлена');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const updatedTicket = await tx.ticket.update({
        where: { id },
        data: {
          managerRating: rating,
          managerRatingSubmittedAt: now,
          lastMessageAt: now,
        },
      });

      await this.createSystemMessage(tx, id, 'Спасибо за оценку');

      return updatedTicket;
    });
  }

  async inviteManager(id: string, inviteManagerDto: InviteManagerDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        invitedManagerIds: true,
        invitedManagerNames: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    const invitedManagerIds = readJsonStringArray(ticket.invitedManagerIds);
    const invitedManagerNames = readJsonStringArray(ticket.invitedManagerNames);

    await this.profilesService.ensureProfile({
      id: inviteManagerDto.managerId,
      fullName: inviteManagerDto.managerName,
      role: 'manager',
    });

    if (invitedManagerIds.includes(inviteManagerDto.managerId)) {
      return this.prisma.ticket.findUnique({
        where: { id },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const updatedTicket = await tx.ticket.update({
        where: { id },
        data: {
          invitedManagerIds: [...invitedManagerIds, inviteManagerDto.managerId],
          invitedManagerNames: [
            ...invitedManagerNames,
            inviteManagerDto.managerName,
          ],
        },
      });

      await tx.message.create({
        data: {
          ticketId: id,
          content: `В диалог приглашён менеджер ${inviteManagerDto.managerName}`,
          senderType: 'system',
          senderRole: 'system',
          status: 'sent',
          deliveryStatus: 'sent',
          messageType: 'system',
        },
      });

      await tx.ticket.update({
        where: { id },
        data: {
          lastMessageAt: now,
        },
      });

      return updatedTicket;
    });
  }

  async removeInvitedManager(
    id: string,
    removeInvitedManagerDto: RemoveInvitedManagerDto,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        invitedManagerIds: true,
        invitedManagerNames: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    const invitedManagerIds = readJsonStringArray(ticket.invitedManagerIds);
    const invitedManagerNames = readJsonStringArray(ticket.invitedManagerNames);
    const removedIndex = invitedManagerIds.indexOf(
      removeInvitedManagerDto.managerId,
    );

    if (removedIndex === -1) {
      return this.prisma.ticket.findUnique({
        where: { id },
      });
    }

    const removedManagerName =
      invitedManagerNames[removedIndex] ?? 'приглашённый менеджер';
    const nextInvitedManagerIds = invitedManagerIds.filter(
      (managerId) => managerId !== removeInvitedManagerDto.managerId,
    );
    const nextInvitedManagerNames = invitedManagerNames.filter(
      (_managerName, index) => index !== removedIndex,
    );

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const updatedTicket = await tx.ticket.update({
        where: { id },
        data: {
          invitedManagerIds: nextInvitedManagerIds,
          invitedManagerNames: nextInvitedManagerNames,
        },
      });

      await tx.message.create({
        data: {
          ticketId: id,
          content: `Менеджер ${removedManagerName} отключён от диалога`,
          senderType: 'system',
          senderRole: 'system',
          status: 'sent',
          deliveryStatus: 'sent',
          messageType: 'system',
        },
      });

      await tx.ticket.update({
        where: { id },
        data: {
          lastMessageAt: now,
        },
      });

      return updatedTicket;
    });
  }

  async assignManager(id: string, assignManagerDto: AssignManagerDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        assignedManagerId: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    await this.profilesService.ensureProfile({
      id: assignManagerDto.managerId,
      fullName: assignManagerDto.managerName,
      role: 'manager',
    });

    if (ticket.assignedManagerId === assignManagerDto.managerId) {
      return this.prisma.ticket.findUnique({
        where: { id },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const updatedTicket = await tx.ticket.update({
        where: { id },
        data: {
          assignedManagerId: assignManagerDto.managerId,
          assignedManagerName: assignManagerDto.managerName,
          invitedManagerIds: [],
          invitedManagerNames: [],
          conversationMode: 'manager',
          currentHandlerType: 'manager',
          aiEnabled: false,
          handedToManagerAt: now,
        },
      });

      await tx.message.create({
        data: {
          ticketId: id,
          content: `Диалог передан менеджеру ${assignManagerDto.managerName}`,
          senderType: 'system',
          senderRole: 'system',
          status: 'sent',
          deliveryStatus: 'sent',
          messageType: 'system',
        },
      });

      await tx.ticket.update({
        where: { id },
        data: {
          lastMessageAt: now,
        },
      });

      return updatedTicket;
    });
  }

  async claimIncoming(id: string, assignManagerDto: AssignManagerDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        aiEnabled: true,
        assignedManagerId: true,
        assignedManagerName: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    await this.profilesService.ensureProfile({
      id: assignManagerDto.managerId,
      fullName: assignManagerDto.managerName,
      role: 'manager',
    });

    if (ticket.aiEnabled) {
      throw new ConflictException(
        'Диалог сейчас ведёт AI и его нельзя взять как обычный входящий',
      );
    }

    if (ticket.status === 'resolved' || ticket.status === 'closed') {
      throw new ConflictException(
        'Диалог уже закрыт и недоступен для взятия в работу',
      );
    }

    if (ticket.assignedManagerId === assignManagerDto.managerId) {
      return this.prisma.ticket.findUnique({
        where: { id },
      });
    }

    if (
      ticket.assignedManagerId &&
      ticket.assignedManagerId !== assignManagerDto.managerId
    ) {
      throw new ConflictException(
        `Диалог уже взят в работу менеджером ${ticket.assignedManagerName ?? 'другим менеджером'}`,
      );
    }

    const now = new Date();
    const updateResult = await this.prisma.ticket.updateMany({
      where: {
        id,
        assignedManagerId: null,
        aiEnabled: false,
        status: {
          notIn: ['resolved', 'closed'],
        },
      },
      data: {
        assignedManagerId: assignManagerDto.managerId,
        assignedManagerName: assignManagerDto.managerName,
        status: 'in_progress',
        conversationMode: 'manager',
        currentHandlerType: 'manager',
        claimedAt: now,
        rescueQueuedAt: null,
        returnedToQueueAt: null,
        handedToManagerAt: now,
      },
    });

    if (updateResult.count === 0) {
      const latestTicket = await this.prisma.ticket.findUnique({
        where: { id },
        select: {
          assignedManagerId: true,
          assignedManagerName: true,
        },
      });

      throw new ConflictException(
        `Диалог уже взят в работу менеджером ${latestTicket?.assignedManagerName ?? 'другим менеджером'}`,
      );
    }

    await this.prisma.message.create({
      data: {
        ticketId: id,
        content: `Диалог взят в работу менеджером ${assignManagerDto.managerName}`,
        senderType: 'system',
        senderRole: 'system',
        status: 'sent',
        deliveryStatus: 'sent',
        messageType: 'system',
      },
    });

    await this.prisma.ticket.update({
      where: { id },
      data: {
        lastMessageAt: now,
      },
    });

    return this.prisma.ticket.findUnique({
      where: { id },
    });
  }

  async enableAiMode(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { id: true, aiEnabled: true },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    if (ticket.aiEnabled) {
      return this.prisma.ticket.findUnique({
        where: { id },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.ticket.update({
        where: { id },
        data: {
          aiEnabled: true,
          conversationMode: 'ai',
          currentHandlerType: 'ai',
          aiActivatedAt: now,
          aiResolved: false,
        },
      });

      await this.createSystemMessage(tx, id, 'AI-помощник подключён к диалогу');

      return tx.ticket.update({
        where: { id },
        data: {
          lastMessageAt: now,
        },
      });
    });
  }

  async disableAiMode(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${id}" not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.ticket.update({
        where: { id },
        data: {
          aiEnabled: false,
          conversationMode: 'manager',
          currentHandlerType: 'manager',
          aiDeactivatedAt: now,
          handedToManagerAt: now,
          aiResolved: false,
        },
      });

      await this.createSystemMessage(
        tx,
        id,
        'AI-помощник отключён. Диалог снова ведёт менеджер',
      );

      return tx.ticket.update({
        where: { id },
        data: {
          status: 'new',
          lastMessageAt: now,
        },
      });
    });
  }
}
