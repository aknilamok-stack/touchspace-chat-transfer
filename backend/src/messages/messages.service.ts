import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TypingService } from '../typing.service';
import { ProfilesService } from '../profiles.service';
import { ChatAiService } from '../chat-ai.service';
import { PushService } from '../push.service';
import { readJsonStringArray } from '../prisma-json.util';
import { resolveTicketClientContext } from '../tickets/client-context.util';
import { EmailService } from '../email/email.service';
import {
  getSupplierRequestSyncState,
  SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE,
} from '../supplier-requests/supplier-request-sync.util';

type MessageViewer = {
  viewerType?: string;
  viewerId?: string;
  viewerEmail?: string;
  tradePointName?: string;
};

type ManagerMessageSuggestionItem = {
  text: string;
  usageCount: number;
  lastUsedAt: string;
};

type CreateMessageInput = {
  ticketId: string;
  content: string;
  senderType: string;
  transport?: 'chat' | 'email';
  managerId?: string;
  managerName?: string;
  senderId?: string;
  senderName?: string;
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
  replyToMessageId?: string;
  replyToContent?: string;
  toEmail?: string | null;
  fromEmail?: string | null;
  subject?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  messageType?: string;
  isInternal?: boolean;
};

type ChatAccessActor = {
  id?: string | null;
  role: string;
};

@Injectable()
export class MessagesService {
  private static readonly EDIT_WINDOW_MS = 20 * 60 * 1000;
  private static readonly OFFLINE_MANAGER_AUTO_REPLY =
    'Спасибо, что написали. Сейчас менеджеры не в сети, но как только кто-то появится, мы сразу вернёмся с ответом.';
  private static readonly OFFLINE_MANAGER_AUTO_REPLY_COOLDOWN_MS =
    15 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly typingService: TypingService,
    private readonly profilesService: ProfilesService,
    private readonly chatAiService: ChatAiService,
    private readonly pushService: PushService,
    private readonly emailService: EmailService,
  ) {}

  private normalizeSuggestionText(value: string) {
    return value.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  private resolveMessageSenderName(message: {
    senderType?: string | null;
    senderProfile?: {
      fullName?: string | null;
      companyName?: string | null;
      supplierId?: string | null;
    } | null;
    ticket?: {
      supplierName?: string | null;
    } | null;
  }) {
    if (message.senderType === 'supplier') {
      return (
        message.senderProfile?.companyName?.trim() ||
        message.ticket?.supplierName?.trim() ||
        message.senderProfile?.fullName?.trim() ||
        null
      );
    }

    return message.senderProfile?.fullName?.trim() || null;
  }

  private async resolveEmailReplyTarget(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    ticketId: string,
    inReplyTo?: string | null,
    references?: string | null,
  ) {
    const candidateMessageIds = Array.from(
      new Set(
        [inReplyTo, references]
          .flatMap((value) =>
            (value ?? '')
              .split(/\s+/)
              .map((item) => item.trim())
              .filter(Boolean),
          )
          .filter(Boolean),
      ),
    );

    if (candidateMessageIds.length === 0) {
      return null;
    }

    const referencedMessages = await tx.message.findMany({
      where: {
        ticketId,
        messageId: {
          in: candidateMessageIds,
        },
      },
      select: {
        id: true,
        content: true,
        messageId: true,
      },
    });

    for (const candidateMessageId of candidateMessageIds) {
      const matchedMessage = referencedMessages.find(
        (message) => message.messageId === candidateMessageId,
      );

      if (matchedMessage) {
        return matchedMessage;
      }
    }

    return null;
  }

  private isSuggestionCandidate(value: string) {
    const collapsed = value.replace(/\s+/g, ' ').trim();

    if (!collapsed || collapsed.length < 4 || collapsed.length > 700) {
      return false;
    }

    const alphanumericChars = collapsed.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

    if (alphanumericChars < 5) {
      return false;
    }

    return true;
  }

  private async registerManagerSuggestion(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    managerId: string,
    content: string,
    usedAt: Date,
  ) {
    if (!this.isSuggestionCandidate(content)) {
      return;
    }

    const phraseText = content.replace(/\s+/g, ' ').trim();
    const phraseTextNormalized = this.normalizeSuggestionText(phraseText);

    await tx.managerMessageSuggestion.upsert({
      where: {
        managerId_phraseTextNormalized: {
          managerId,
          phraseTextNormalized,
        },
      },
      create: {
        managerId,
        phraseText,
        phraseTextNormalized,
        usageCount: 1,
        lastUsedAt: usedAt,
      },
      update: {
        phraseText,
        usageCount: {
          increment: 1,
        },
        lastUsedAt: usedAt,
        isHidden: false,
      },
    });
  }

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
        content: MessagesService.OFFLINE_MANAGER_AUTO_REPLY,
        createdAt: {
          gte: new Date(
            triggerCreatedAt.getTime() -
              MessagesService.OFFLINE_MANAGER_AUTO_REPLY_COOLDOWN_MS,
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
      MessagesService.OFFLINE_MANAGER_AUTO_REPLY,
    );

    return true;
  }

  private async markClientMessagesAsRead(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    ticketId: string,
    readAt: Date,
  ) {
    await tx.message.updateMany({
      where: {
        ticketId,
        senderType: 'client',
        status: {
          in: ['sent', 'delivered'],
        },
      },
      data: {
        status: 'read',
        deliveryStatus: 'read',
        readAt,
      },
    });
  }

  private async assertTicketAccess(ticketId: string, viewer?: MessageViewer) {
    const viewerType = viewer?.viewerType?.trim();
    const viewerId = viewer?.viewerId?.trim();
    const viewerEmail = viewer?.viewerEmail?.trim().toLowerCase();
    const tradePointName = viewer?.tradePointName?.trim().replace(/\s+/g, ' ');

    if (!viewerType) {
      return;
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        clientId: true,
        tradePointName: true,
        canonicalEmail: true,
        clientEmail: true,
        currentUserEmail: true,
        superuserEmail: true,
        supplierId: true,
        assignedManagerId: true,
        invitedManagerIds: true,
        supplierRequests: {
          select: {
            supplierId: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket with id "${ticketId}" not found`);
    }

    const invitedManagerIds = readJsonStringArray(ticket.invitedManagerIds);

    if (viewerType === 'client') {
      const ticketTradePointName =
        ticket.tradePointName?.trim().replace(/\s+/g, ' ') ?? '';
      const ticketEmails = [
        ticket.canonicalEmail,
        ticket.clientEmail,
        ticket.currentUserEmail,
        ticket.superuserEmail,
      ]
        .map((value) => value?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value));

      if (ticket.clientId === viewerId) {
        return;
      }

      if (
        viewerEmail &&
        tradePointName &&
        ticketTradePointName &&
        tradePointName.toLowerCase() === ticketTradePointName.toLowerCase() &&
        ticketEmails.includes(viewerEmail)
      ) {
        return;
      }
    }

    if (
      viewerType === 'supplier' &&
      (ticket.supplierId === viewerId ||
        ticket.supplierRequests.some(
          (supplierRequest) => supplierRequest.supplierId === viewerId,
        ))
    ) {
      return;
    }

    if (
      viewerType === 'manager' &&
      viewerId
    ) {
      return;
    }

    throw new ForbiddenException('No access to this ticket');
  }

  private async assertActorChatAccess(actor: ChatAccessActor) {
    const normalizedId = actor.id?.trim();

    if (!normalizedId || (actor.role !== 'manager' && actor.role !== 'supplier')) {
      return;
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: normalizedId },
      select: {
        id: true,
        fullName: true,
        chatAccessEnabled: true,
      },
    });

    if (!profile) {
      return;
    }

    if (!profile.chatAccessEnabled) {
      throw new ForbiddenException(
        actor.role === 'manager'
          ? 'Менеджеру отключена возможность отвечать в чатах'
          : 'Оператору поставщика отключена возможность отвечать в чатах',
      );
    }
  }

  private async getLatestOpenSupplierRequestState(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    ticketId: string,
  ) {
    const ticketRequests = await tx.supplierRequest.findMany({
      where: {
        ticketId,
      },
      select: {
        id: true,
        createdAt: true,
        status: true,
        assignedSupplierProfileId: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const latestOpenRequest = [...ticketRequests]
      .reverse()
      .find((request) => !['closed', 'cancelled', 'resolved'].includes(request.status));

    if (!latestOpenRequest) {
      return null;
    }

    const controlMessages = await tx.message.findMany({
      where: {
        ticketId,
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

    const syncState = getSupplierRequestSyncState(
      ticketRequests,
      controlMessages,
      latestOpenRequest.id,
    );

    return {
      request: latestOpenRequest,
      syncState,
    };
  }

  async create(input: CreateMessageInput) {
    const {
      ticketId,
      content,
      senderType,
      managerId,
      managerName,
      senderId,
      senderName,
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
      replyToMessageId,
      replyToContent,
    } = input;
    const actorId = senderId ?? managerId;
    const actorName = senderName ?? managerName;
    const normalizedTransport = input.transport === 'email' ? 'email' : 'chat';
    const normalizedMessageType =
      input.messageType?.trim() ||
      (normalizedTransport === 'email' ? 'email' : 'text');
    const isInternal =
      senderType === 'manager' &&
      normalizedTransport === 'chat' &&
      Boolean(input.isInternal);

    let emailMetadata = {
      toEmail: input.toEmail?.trim() || null,
      fromEmail: input.fromEmail?.trim() || null,
      subject: input.subject?.trim() || null,
      messageId: input.messageId?.trim() || null,
      inReplyTo: input.inReplyTo?.trim() || null,
      references: input.references?.trim() || null,
    };

    if (senderType === 'manager' && normalizedTransport === 'email') {
      const outboundEmail = await this.emailService.sendTicketEmail({
        ticketId,
        content,
        toEmail: input.toEmail,
      });

      emailMetadata = outboundEmail;
    }

    if (actorId) {
      await this.profilesService.ensureProfile({
        id: actorId,
        fullName: actorName,
        role: senderType,
      });
    }

    await this.assertActorChatAccess({
      id: actorId,
      role: senderType,
    });

    if (senderType === 'supplier') {
      const latestSupplierRequestState = await this.prisma.$transaction((tx) =>
        this.getLatestOpenSupplierRequestState(tx, ticketId),
      );

      if (latestSupplierRequestState?.syncState.isPaused) {
        throw new ForbiddenException(
          latestSupplierRequestState.syncState.mode === 'awaiting_manager'
            ? 'Ожидайте, пока менеджер разрешит вернуться в чат.'
            : 'Поставщик сейчас на паузе. Сначала нажмите "Вернуться в диалог".',
        );
      }
    }

    const { message, shouldAiReply, ticketSnapshot } =
      await this.prisma.$transaction(async (tx) => {
        const ticket = await tx.ticket.findUnique({
          where: { id: ticketId },
          select: {
            id: true,
            title: true,
            status: true,
            aiEnabled: true,
            currentHandlerType: true,
            conversationMode: true,
            firstResponseStartedAt: true,
            firstResponseAt: true,
            assignedManagerId: true,
            assignedManagerName: true,
            invitedManagerIds: true,
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
            supplierName: true,
          },
        });

        if (!ticket) {
          throw new NotFoundException(`Ticket with id "${ticketId}" not found`);
        }

        const supplierActorProfile =
          senderType === 'supplier' && actorId
            ? await tx.profile.findUnique({
                where: { id: actorId },
                select: {
                  supplierId: true,
                  companyName: true,
                  fullName: true,
                },
              })
            : null;

        if (senderType === 'manager') {
          const invitedManagerIds = readJsonStringArray(ticket.invitedManagerIds);
          const canManagerWrite =
            ticket.assignedManagerId === null ||
            ticket.assignedManagerId === actorId ||
            invitedManagerIds.includes(actorId ?? '');

          if (!canManagerWrite) {
            throw new ForbiddenException(
              'Менеджер может отвечать в этом диалоге только после подключения к нему',
            );
          }
        }

        const isClientReopeningResolvedDialog =
          senderType === 'client' && ticket.status === 'resolved';

        if (isClientReopeningResolvedDialog) {
          const reopenedAt = new Date();

          await tx.ticket.update({
            where: { id: ticketId },
            data: {
              status: 'new',
              requestCount: {
                increment: 1,
              },
              assignedManagerId: null,
              assignedManagerName: null,
              handedToManagerAt: null,
              conversationMode: 'manager',
              currentHandlerType: 'manager',
              aiEnabled: false,
              firstResponseStartedAt: reopenedAt,
              firstResponseAt: null,
              firstResponseTime: null,
              firstResponseBreached: false,
              managerRating: null,
              managerRatingSubmittedAt: null,
              resolvedAt: null,
              closedAt: null,
              lastMessageAt: reopenedAt,
            },
          });
        }

        const emailReplyTarget =
          senderType === 'client' && normalizedTransport === 'email'
            ? await this.resolveEmailReplyTarget(
                tx,
                ticketId,
                emailMetadata.inReplyTo,
                emailMetadata.references,
              )
            : null;

        const message = await tx.message.create({
          data: {
            ticketId,
            content,
            senderType,
            senderRole: senderType,
            senderProfileId: actorId ?? null,
            replyToMessageId:
              replyToMessageId?.trim() || emailReplyTarget?.id || null,
            replyToContent:
              replyToContent?.trim() || emailReplyTarget?.content?.trim() || null,
            status: 'sent',
            deliveryStatus: 'sent',
            messageType: normalizedMessageType,
            transport: normalizedTransport,
            toEmail: emailMetadata.toEmail,
            fromEmail: emailMetadata.fromEmail,
            subject: emailMetadata.subject,
            messageId: emailMetadata.messageId,
            inReplyTo: emailMetadata.inReplyTo,
            references: emailMetadata.references,
            isInternal,
          },
        });

        const managerMessagesCount = await tx.message.count({
          where: {
            ticketId,
            senderType: 'manager',
          },
        });

        let nextStatus = ticket.status;

        if (senderType === 'client') {
          nextStatus = isClientReopeningResolvedDialog
            ? 'new'
            : managerMessagesCount > 0
              ? 'in_progress'
              : 'new';
        }

        if (senderType === 'manager') {
          nextStatus = 'waiting_client';
        }

        if (senderType === 'client' && ticket.aiEnabled) {
          nextStatus = 'waiting_client';
        }

        if (senderType === 'supplier') {
          nextStatus = 'in_progress';
        }

        const ticketUpdateData: Record<string, unknown> = {
          lastMessageAt: message.createdAt,
          closedAt: null,
        };

        if (nextStatus !== ticket.status) {
          ticketUpdateData.status = nextStatus;
        }

        if (senderType === 'client') {
          ticketUpdateData.lastClientMessageAt = message.createdAt;
          ticketUpdateData.claimRequiredAt =
            ticket.assignedManagerId === null ? message.createdAt : undefined;
          ticketUpdateData.claimMissedAt =
            ticket.assignedManagerId === null ? null : undefined;
          ticketUpdateData.returnedToQueueAt =
            ticket.assignedManagerId === null ? null : undefined;
          ticketUpdateData.rescueQueuedAt =
            ticket.assignedManagerId === null ? null : undefined;
          const clientContext = resolveTicketClientContext(
            {
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
            ticket,
          );

          ticketUpdateData.clientId = clientContext.clientId ?? ticket.clientId;
          ticketUpdateData.clientName =
            clientContext.clientName ?? ticket.clientName;
          ticketUpdateData.tradePointExternalId =
            clientContext.tradePointExternalId;
          ticketUpdateData.tradePointName =
            clientContext.tradePointName ?? ticket.tradePointName;
          ticketUpdateData.clientEmail = clientContext.clientEmail;
          ticketUpdateData.clientPhone = clientContext.clientPhone;
          ticketUpdateData.currentUserId = clientContext.currentUserId;
          ticketUpdateData.currentUserEmail = clientContext.currentUserEmail;
          ticketUpdateData.currentUserPhone = clientContext.currentUserPhone;
          ticketUpdateData.currentUserXmlId = clientContext.currentUserXmlId;
          ticketUpdateData.isSuperuser = clientContext.isSuperuser;
          ticketUpdateData.superuserId = clientContext.superuserId;
          ticketUpdateData.superuserEmail = clientContext.superuserEmail;
          ticketUpdateData.superuserPhone = clientContext.superuserPhone;
          ticketUpdateData.canonicalEmail = clientContext.canonicalEmail;
          ticketUpdateData.canonicalEmailSource =
            clientContext.canonicalEmailSource;
          ticketUpdateData.lockedBySuperuser = clientContext.lockedBySuperuser;
          if (ticket.aiEnabled) {
            ticketUpdateData.currentHandlerType = 'ai';
            ticketUpdateData.conversationMode = 'ai';
          }
        }

        if (senderType === 'supplier') {
          ticketUpdateData.supplierId =
            supplierActorProfile?.supplierId?.trim() ||
            ticket.supplierId ||
            actorId ||
            null;
          ticketUpdateData.supplierName =
            supplierActorProfile?.companyName?.trim() ||
            actorName ||
            ticket.supplierName;
        }

        if (senderType === 'manager') {
          ticketUpdateData.lastManagerReplyAt = message.createdAt;
          ticketUpdateData.claimMissedAt = null;
          ticketUpdateData.returnedToQueueAt = null;
          ticketUpdateData.rescueQueuedAt = null;
        }

        await tx.ticket.update({
          where: { id: ticketId },
          data: ticketUpdateData,
        });

        if (senderType === 'manager' && !ticket.firstResponseAt) {
          const startedAt = ticket.firstResponseStartedAt ?? new Date();
          const durationMs = Math.max(
            message.createdAt.getTime() - startedAt.getTime(),
            0,
          );

          await tx.ticket.update({
            where: { id: ticketId },
            data: {
              firstResponseAt: message.createdAt,
              firstResponseTime: durationMs,
              firstResponseBreached: durationMs > 2 * 60 * 1000,
            },
          });
        }

        if (
          senderType === 'manager' &&
          managerId &&
          managerName &&
          !ticket.assignedManagerId
        ) {
          await tx.ticket.update({
            where: { id: ticketId },
            data: {
              assignedManagerId: managerId,
              assignedManagerName: managerName,
              claimedAt: message.createdAt,
            },
          });
        }

        if (senderType === 'supplier') {
          const activeSupplierRequest = await tx.supplierRequest.findFirst({
            where: {
              ticketId,
              status: {
                notIn: ['closed', 'cancelled'],
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
          });

          if (activeSupplierRequest) {
            const startedAt =
              activeSupplierRequest.responseStartedAt ??
              activeSupplierRequest.createdAt;
            const durationMs = Math.max(
              message.createdAt.getTime() - startedAt.getTime(),
              0,
            );

            await tx.supplierRequest.update({
              where: { id: activeSupplierRequest.id },
              data: {
                lastSupplierReplyAt: message.createdAt,
                respondedAt: message.createdAt,
                ...(activeSupplierRequest.firstResponseAt
                  ? {}
                  : {
                      firstResponseAt: message.createdAt,
                      responseTime: durationMs,
                      responseBreached: durationMs > 60 * 60 * 1000,
                    }),
              },
            });
          }
        }

        if (senderType === 'client') {
          this.typingService.clearTyping(ticketId, 'client');
          await this.maybeCreateOfflineManagerAutoReply(
            tx,
            ticketId,
            message.createdAt,
          );
        }

        if (senderType === 'manager') {
          if (managerId) {
            await this.registerManagerSuggestion(
              tx,
              managerId,
              content,
              message.createdAt,
            );
          }
          this.typingService.clearTyping(ticketId, 'manager');
          await this.markClientMessagesAsRead(tx, ticketId, message.createdAt);
        }

        if (senderType === 'manager' && ticket.aiEnabled) {
          await this.createSystemMessage(
            tx,
            ticketId,
            'Менеджер подключился к диалогу',
          );
          await tx.ticket.update({
            where: { id: ticketId },
            data: {
              aiEnabled: false,
              currentHandlerType: 'manager',
              conversationMode: 'manager',
              aiDeactivatedAt: message.createdAt,
              handedToManagerAt: message.createdAt,
              lastMessageAt: message.createdAt,
            },
          });
        }

        return {
          message,
          shouldAiReply: senderType === 'client' && ticket.aiEnabled,
          ticketSnapshot: {
            id: ticket.id,
            title: ticket.title ?? 'Диалог TouchSpace',
            assignedManagerId: ticket.assignedManagerId,
            invitedManagerIds: ticket.invitedManagerIds,
            supplierId: ticket.supplierId,
            aiEnabled: ticket.aiEnabled,
          },
        };
      });

    if (shouldAiReply) {
      void this.chatAiService.persistAiTurn(ticketId).catch((error) => {
        console.error('Ошибка AI-ответа в message flow:', error);
      });
    } else if (senderType === 'client') {
      void this.pushService
        .getManagerTargetsForTicket(ticketId)
        .then((targets) =>
          this.pushService.sendToProfiles(
            targets,
            {
              title: 'Новое сообщение от клиента',
              body:
                content.length > 120 ? `${content.slice(0, 120)}...` : content,
              url: `/?ticket=${ticketId}`,
              tag: `ticket-${ticketId}`,
            },
            'client_chats',
            actorId,
          ),
        )
        .catch((error) =>
          console.error('Ошибка push-уведомления для менеджеров:', error),
        );

      void this.prisma.supplierRequest
        .findFirst({
          where: {
            ticketId,
            status: { notIn: ['closed', 'cancelled'] },
            assignedSupplierProfileId: { not: null },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            supplierId: true,
            assignedSupplierProfileId: true,
          },
        })
        .then(async (activeRequest) => {
          if (!activeRequest) return null;

          const ticketRequests = await this.prisma.supplierRequest.findMany({
            where: { ticketId },
            select: { id: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          });
          const controlMessages = await this.prisma.message.findMany({
            where: { ticketId, messageType: SUPPLIER_REQUEST_SYNC_MESSAGE_TYPE },
            select: { content: true, createdAt: true, messageType: true },
            orderBy: { createdAt: 'asc' },
          });
          const syncState = getSupplierRequestSyncState(
            ticketRequests,
            controlMessages,
            activeRequest.id,
          );

          return syncState.isPaused ? null : activeRequest;
        })
        .then((activeRequest) =>
          activeRequest
            ? this.pushService.sendToProfiles(
                [activeRequest.assignedSupplierProfileId!],
                {
                  title: 'Новое сообщение от клиента',
                  body:
                    content.length > 120
                      ? `${content.slice(0, 120)}...`
                      : content,
                  url: `/supplier?ticket=${ticketId}`,
                  tag: `supplier-ticket-${ticketId}`,
                },
                'supplier_chats',
                actorId,
              )
            : undefined,
        )
        .catch((error) =>
          console.error('Ошибка push-уведомления поставщику (клиент):', error),
        );
    } else if (senderType === 'supplier') {
      const managerTargets = [
        ticketSnapshot.assignedManagerId,
        ...readJsonStringArray(ticketSnapshot.invitedManagerIds),
      ].filter((value): value is string => Boolean(value));

      void this.pushService
        .sendToProfiles(
          [...new Set(managerTargets)],
          {
            title: 'Новое сообщение от поставщика',
            body:
              content.length > 120 ? `${content.slice(0, 120)}...` : content,
            url: `/?ticket=${ticketId}`,
            tag: `ticket-${ticketId}`,
          },
          'supplier_chats',
          actorId,
        )
        .catch((error) =>
          console.error(
            'Ошибка push-уведомления для менеджера по сообщению поставщика:',
            error,
          ),
        );
    } else if (senderType === 'manager') {
      void this.prisma.supplierRequest
        .findFirst({
          where: {
            ticketId,
            status: {
              notIn: ['closed', 'cancelled'],
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          select: {
            id: true,
            supplierId: true,
            assignedSupplierProfileId: true,
          },
        })
        .then(async (activeRequest) => {
          if (activeRequest) {
            await this.prisma.supplierRequest.update({
              where: { id: activeRequest.id },
              data: {
                lastManagerMessageAt: message.createdAt,
                claimRequiredAt:
                  activeRequest.assignedSupplierProfileId === null
                    ? message.createdAt
                    : undefined,
                claimMissedAt:
                  activeRequest.assignedSupplierProfileId === null
                    ? null
                    : undefined,
                returnedToQueueAt:
                  activeRequest.assignedSupplierProfileId === null
                    ? null
                    : undefined,
              },
            });
          }

          if (!activeRequest) {
            return null;
          }

          const ticketRequests = await this.prisma.supplierRequest.findMany({
            where: {
              ticketId,
            },
            select: {
              id: true,
              createdAt: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          });
          const controlMessages = await this.prisma.message.findMany({
            where: {
              ticketId,
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
          const syncState = getSupplierRequestSyncState(
            ticketRequests,
            controlMessages,
            activeRequest.id,
          );

          return {
            ...activeRequest,
            supplierSyncPaused: syncState.isPaused,
          };
        })
        .then((activeRequest) =>
          !activeRequest || activeRequest.supplierSyncPaused
            ? []
            : activeRequest.assignedSupplierProfileId
            ? [activeRequest.assignedSupplierProfileId]
            : this.pushService.getActiveSupplierProfileIds(activeRequest.supplierId),
        )
        .then((supplierTargets) =>
          this.pushService.sendToProfiles(
            supplierTargets,
            {
              title: 'Новое сообщение по вашему запросу',
              body:
                content.length > 120 ? `${content.slice(0, 120)}...` : content,
              url: `/supplier?ticket=${ticketId}`,
              tag: `supplier-ticket-${ticketId}`,
            },
            'supplier_chats',
            actorId,
          ),
        )
        .catch((error) =>
          console.error('Ошибка push-уведомления поставщику:', error),
        );
    }

    return message;
  }

  async findManagerSuggestions(
    managerId: string,
    query: string,
  ): Promise<{ suggestions: ManagerMessageSuggestionItem[] }> {
    const normalizedQuery = this.normalizeSuggestionText(query);

    if (!managerId.trim() || normalizedQuery.length < 2) {
      return { suggestions: [] };
    }

    const candidates = await this.prisma.managerMessageSuggestion.findMany({
      where: {
        managerId,
        isHidden: false,
        OR: [
          {
            phraseTextNormalized: {
              startsWith: normalizedQuery,
            },
          },
          {
            phraseTextNormalized: {
              contains: normalizedQuery,
            },
          },
        ],
      },
      take: 25,
      orderBy: [{ usageCount: 'desc' }, { lastUsedAt: 'desc' }],
    });

    const fallbackMessages = await this.prisma.message.findMany({
      where: {
        senderType: 'manager',
        senderProfileId: managerId,
        messageType: 'text',
        isInternal: false,
      },
      select: {
        content: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });

    const merged = new Map<
      string,
      {
        phraseText: string;
        phraseTextNormalized: string;
        usageCount: number;
        lastUsedAt: Date;
      }
    >();

    for (const item of candidates) {
      merged.set(item.phraseTextNormalized, {
        phraseText: item.phraseText,
        phraseTextNormalized: item.phraseTextNormalized,
        usageCount: item.usageCount,
        lastUsedAt: item.lastUsedAt,
      });
    }

    for (const message of fallbackMessages) {
      if (!this.isSuggestionCandidate(message.content)) {
        continue;
      }

      const phraseText = message.content.replace(/\s+/g, ' ').trim();
      const phraseTextNormalized = this.normalizeSuggestionText(phraseText);

      if (!phraseTextNormalized.includes(normalizedQuery)) {
        continue;
      }

      const existing = merged.get(phraseTextNormalized);

      if (existing) {
        if (message.createdAt > existing.lastUsedAt) {
          existing.lastUsedAt = message.createdAt;
          existing.phraseText = phraseText;
        }
        existing.usageCount += 1;
      } else {
        merged.set(phraseTextNormalized, {
          phraseText,
          phraseTextNormalized,
          usageCount: 1,
          lastUsedAt: message.createdAt,
        });
      }
    }

    const ranked = Array.from(merged.values())
      .filter((item) => item.phraseTextNormalized.includes(normalizedQuery))
      .map((item) => {
        const isPrefix = item.phraseTextNormalized.startsWith(normalizedQuery);
        const freshnessScore = new Date(item.lastUsedAt).getTime();

        return {
          item,
          isPrefix,
          freshnessScore,
        };
      })
      .sort((left, right) => {
        if (left.isPrefix !== right.isPrefix) {
          return left.isPrefix ? -1 : 1;
        }

        if (left.item.usageCount !== right.item.usageCount) {
          return right.item.usageCount - left.item.usageCount;
        }

        if (left.freshnessScore !== right.freshnessScore) {
          return right.freshnessScore - left.freshnessScore;
        }

        return left.item.phraseText.length - right.item.phraseText.length;
      })
      .slice(0, 5)
      .map(({ item }) => ({
        text: item.phraseText,
        usageCount: item.usageCount,
        lastUsedAt: item.lastUsedAt.toISOString(),
      }));

    return {
      suggestions: ranked,
    };
  }

  async createAttachment(
    files: any[],
    ticketId: string,
    senderType: string,
    managerId?: string,
    managerName?: string,
    senderId?: string,
    senderName?: string,
    tradePointId?: string,
    tradePointExternalId?: string,
    tradePointName?: string,
    currentUserId?: string,
    currentUserEmail?: string,
    currentUserPhone?: string,
    currentUserXmlId?: string,
    isSuperuser?: boolean | string,
    superuserId?: string,
    superuserEmail?: string,
    superuserPhone?: string,
    canonicalEmail?: string,
    canonicalEmailSource?: string,
    clientEmail?: string,
    clientPhone?: string,
    caption?: string,
    replyToMessageId?: string,
    replyToContent?: string,
  ) {
    if (!files?.length) {
      throw new NotFoundException('Attachment file is required');
    }

    if (files.length > 5) {
      throw new BadRequestException(
        'Можно прикрепить не больше 5 файлов за раз',
      );
    }

    const totalSize = files.reduce(
      (sum, file) => sum + (typeof file?.size === 'number' ? file.size : 0),
      0,
    );

    if (totalSize > 5 * 1024 * 1024) {
      throw new BadRequestException(
        'Суммарный размер вложений в одном сообщении не должен превышать 5 МБ',
      );
    }

    const actorId = senderId ?? managerId;
    const actorName = senderName ?? managerName;

    if (actorId) {
      await this.profilesService.ensureProfile({
        id: actorId,
        fullName: actorName,
        role: senderType,
      });
    }

    await this.assertActorChatAccess({
      id: actorId,
      role: senderType,
    });

    const trimmedCaption = caption?.trim() || '';
    const attachments = files.map((file) => ({
      name: file.originalname,
      url: `/uploads/${file.filename}`,
      mimeType: file.mimetype,
      size: file.size,
      caption: trimmedCaption,
    }));
    const attachmentPayload = JSON.stringify({
      attachments,
    });

    return this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findUnique({
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
        },
      });

      if (!ticket) {
        throw new NotFoundException(`Ticket with id "${ticketId}" not found`);
      }

      const message = await tx.message.create({
        data: {
          ticketId,
          content: attachmentPayload,
          senderType,
          senderRole: senderType,
          senderProfileId: actorId ?? null,
          replyToMessageId: replyToMessageId?.trim() || null,
          replyToContent: replyToContent?.trim() || null,
          status: 'sent',
          deliveryStatus: 'sent',
          messageType: 'attachment',
          isInternal: false,
        },
      });

      const clientContext =
        senderType === 'client'
          ? resolveTicketClientContext(
              {
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
              ticket,
            )
          : null;

      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          lastMessageAt: message.createdAt,
          closedAt: null,
          status: senderType === 'client' ? 'new' : undefined,
          clientId: clientContext?.clientId,
          clientName: clientContext?.clientName,
          tradePointExternalId: clientContext?.tradePointExternalId,
          tradePointName: clientContext?.tradePointName,
          clientEmail: clientContext?.clientEmail,
          clientPhone: clientContext?.clientPhone,
          currentUserId: clientContext?.currentUserId,
          currentUserEmail: clientContext?.currentUserEmail,
          currentUserPhone: clientContext?.currentUserPhone,
          currentUserXmlId: clientContext?.currentUserXmlId,
          isSuperuser: clientContext?.isSuperuser,
          superuserId: clientContext?.superuserId,
          superuserEmail: clientContext?.superuserEmail,
          superuserPhone: clientContext?.superuserPhone,
          canonicalEmail: clientContext?.canonicalEmail,
          canonicalEmailSource: clientContext?.canonicalEmailSource,
          lockedBySuperuser: clientContext?.lockedBySuperuser,
        },
      });

      if (senderType === 'manager') {
        this.typingService.clearTyping(ticketId, 'manager');
        await this.markClientMessagesAsRead(tx, ticketId, message.createdAt);
      }

      if (senderType === 'client') {
        this.typingService.clearTyping(ticketId, 'client');
        await this.maybeCreateOfflineManagerAutoReply(
          tx,
          ticketId,
          message.createdAt,
        );
      }

      return message;
    });
  }

  async findByTicket(
    ticketId: string,
    viewer?: MessageViewer,
    markAsRead = false,
  ) {
    await this.assertTicketAccess(ticketId, viewer);

    const viewerType = viewer?.viewerType?.trim();

    return this.prisma.$transaction(async (tx) => {
      if (viewerType) {
        const readAt = markAsRead ? new Date() : null;
        const statusToSet = markAsRead ? 'read' : 'delivered';

        await tx.message.updateMany({
          where: {
            ticketId,
            ...(viewerType === 'client' ? { isInternal: false } : {}),
            senderType: {
              notIn: [viewerType, 'system'],
            },
            status: markAsRead
              ? {
                  in: ['sent', 'delivered'],
                }
              : 'sent',
          },
          data: {
            status: statusToSet,
            deliveryStatus: statusToSet,
            readAt,
          },
        });
      }

      const messages = await tx.message.findMany({
        where: {
          ticketId,
          ...(viewerType === 'client' ? { isInternal: false } : {}),
        },
        orderBy: { createdAt: 'asc' },
        include: {
          senderProfile: {
            select: {
              fullName: true,
              companyName: true,
              supplierId: true,
            },
          },
          ticket: {
            select: {
              supplierName: true,
            },
          },
        },
      });

      return messages.map((message) => ({
        ...message,
        senderName: this.resolveMessageSenderName(message),
      }));
    });
  }

  async update(
    messageId: string,
    content: string,
    senderType: 'manager' | 'supplier',
    senderId: string,
  ) {
    const normalizedContent = content.trim();
    const normalizedSenderId = senderId.trim();

    if (!normalizedContent) {
      throw new BadRequestException('Сообщение не может быть пустым');
    }

    if (!normalizedSenderId) {
      throw new BadRequestException('senderId is required');
    }

    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        senderProfile: {
          select: {
            fullName: true,
            companyName: true,
            supplierId: true,
          },
        },
        ticket: {
          select: {
            supplierName: true,
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException(`Message with id "${messageId}" not found`);
    }

    if (message.senderType !== senderType) {
      throw new ForbiddenException('Можно редактировать только свои сообщения');
    }

    if (message.senderProfileId !== normalizedSenderId) {
      throw new ForbiddenException('Можно редактировать только свои сообщения');
    }

    await this.assertActorChatAccess({
      id: normalizedSenderId,
      role: senderType,
    });

    if (message.messageType !== 'text' || message.transport !== 'chat') {
      throw new BadRequestException(
        'Редактировать можно только обычные чат-сообщения',
      );
    }

    if (
      Date.now() - new Date(message.createdAt).getTime() >
      MessagesService.EDIT_WINDOW_MS
    ) {
      throw new BadRequestException(
        'Сообщение можно редактировать только в течение 20 минут после отправки',
      );
    }

    const updatedMessage = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        content: normalizedContent,
      },
      include: {
        senderProfile: {
          select: {
            fullName: true,
            companyName: true,
            supplierId: true,
          },
        },
        ticket: {
          select: {
            supplierName: true,
          },
        },
      },
    });

    return {
      ...updatedMessage,
      senderName: this.resolveMessageSenderName(updatedMessage),
    };
  }
}
