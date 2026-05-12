import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AiTextClient } from './ai-text-client';
import { PrismaService } from './prisma.service';
import { PushService } from './push.service';

type AiChatReply = {
  reply: string;
  shouldHandoff: boolean;
  handoffReason: string | null;
  resolved: boolean;
};

@Injectable()
export class ChatAiService {
  private readonly aiClient: AiTextClient;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
  ) {
    this.aiClient = new AiTextClient('chat');
  }

  private extractJson(text: string) {
    const fencedMatch = text.match(/```json\s*([\s\S]*?)```/i);

    if (fencedMatch?.[1]) {
      return fencedMatch[1].trim();
    }

    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');

    if (objectStart >= 0 && objectEnd > objectStart) {
      return text.slice(objectStart, objectEnd + 1);
    }

    return text;
  }

  private normalizeReply(value: unknown): AiChatReply {
    if (!value || typeof value !== 'object') {
      return {
        reply: 'Я подключаю менеджера TouchSpace, чтобы помочь точнее.',
        shouldHandoff: true,
        handoffReason: 'Не удалось получить структурированный ответ от AI.',
        resolved: false,
      };
    }

    const payload = value as Partial<AiChatReply>;

    return {
      reply:
        typeof payload.reply === 'string' && payload.reply.trim()
          ? payload.reply.trim()
          : 'Я подключаю менеджера TouchSpace, чтобы помочь точнее.',
      shouldHandoff: Boolean(payload.shouldHandoff),
      handoffReason:
        typeof payload.handoffReason === 'string' &&
        payload.handoffReason.trim()
          ? payload.handoffReason.trim()
          : null,
      resolved: Boolean(payload.resolved),
    };
  }

  private parseResponse(text: string) {
    try {
      const parsed = JSON.parse(this.extractJson(text));
      return this.normalizeReply(parsed);
    } catch {
      throw new InternalServerErrorException(
        'AI вернул ответ для чата, который не удалось разобрать как JSON.',
      );
    }
  }

  private getRecentClientMessages(
    messages: Array<{
      senderType: string;
      content: string;
    }>,
  ) {
    return messages
      .filter((message) => message.senderType === 'client')
      .slice(-12);
  }

  private countManagerRequests(
    messages: Array<{
      senderType: string;
      content: string;
    }>,
  ) {
    const patterns = [
      'оператор',
      'менеджер',
      'человек',
      'живой',
      'сотрудник',
      'специалист',
      'позови',
      'переключи',
      'соедините',
      'связать',
      'свяжите',
      'передай менеджеру',
      'хочу менеджера',
      'хочу оператора',
    ];

    return this.getRecentClientMessages(messages).filter((message) => {
      const normalized = message.content.toLowerCase();
      return patterns.some((pattern) => normalized.includes(pattern));
    }).length;
  }

  private buildPrompt(dialog: {
    id: string;
    title: string;
    status: string;
    clientName: string | null;
    assignedManagerName: string | null;
    messages: Array<{
      senderType: string;
      messageType: string;
      content: string;
      createdAt: Date;
    }>;
  }) {
    const transcript = dialog.messages
      .slice(-20)
      .map(
        (message) =>
          `[${message.createdAt.toISOString()}] ${message.senderType}/${message.messageType}: ${message.content}`,
      )
      .join('\n');

    return `
Ты отвечаешь как AI-помощник внутри клиентского чата TouchSpace.

Верни строго JSON без markdown:
{
  "reply": "ответ клиенту на русском",
  "shouldHandoff": false,
  "handoffReason": null,
  "resolved": false
}

Правила:
- Пиши по-русски, дружелюбно и по делу.
- Если клиент явно просит человека, менеджера, оператора, живого сотрудника или AI не хватает контекста, ставь shouldHandoff=true.
- Если вопрос требует обещаний по заказу, точных сроков без данных, коммерческого решения или ручной проверки, лучше ставь shouldHandoff=true.
- Если можешь помочь общим ответом или уточняющим вопросом, отвечай сам.
- reply должен быть готовым сообщением клиенту.
- handoffReason коротко объясняет причину передачи менеджеру.
- resolved=true только если вопрос закрыт полностью и менеджер не нужен.

Метаданные:
- Ticket ID: ${dialog.id}
- Заголовок: ${dialog.title}
- Статус: ${dialog.status}
- Клиент: ${dialog.clientName ?? 'не указан'}
- Менеджер: ${dialog.assignedManagerName ?? 'не назначен'}

История:
${transcript}
`.trim();
  }

  async generateReply(ticketId: string) {
    const dialog = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            senderType: true,
            messageType: true,
            content: true,
            createdAt: true,
          },
        },
      },
    });

    if (!dialog) {
      throw new InternalServerErrorException(
        `Ticket with id "${ticketId}" not found`,
      );
    }

    const managerRequestsCount = this.countManagerRequests(dialog.messages);

    if (managerRequestsCount >= 2) {
      return {
        model: 'rule-based-handoff',
        reply:
          'Понял, подключаю менеджера TouchSpace. Он продолжит диалог в этом же чате.',
        shouldHandoff: true,
        handoffReason: 'Клиент повторно запросил оператора или менеджера.',
        resolved: false,
      };
    }

    const text = await this.aiClient.generateText(this.buildPrompt(dialog));

    return {
      model: this.aiClient.model,
      provider: this.aiClient.provider,
      ...this.parseResponse(text),
    };
  }

  async persistAiTurn(ticketId: string) {
    const aiReply = await this.generateReply(ticketId);
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const aiMessage = await tx.message.create({
        data: {
          ticketId,
          content: aiReply.reply,
          senderType: 'ai',
          senderRole: 'ai',
          status: 'sent',
          deliveryStatus: 'sent',
          messageType: 'ai_response',
          isInternal: false,
        },
      });

      const ticketUpdateData: Record<string, unknown> = {
        lastMessageAt: aiMessage.createdAt,
        currentHandlerType: 'ai',
        conversationMode: 'ai',
        aiEnabled: true,
        aiResolved: aiReply.resolved,
      };

      if (aiReply.shouldHandoff) {
        ticketUpdateData.currentHandlerType = 'manager';
        ticketUpdateData.conversationMode = 'manager';
        ticketUpdateData.aiEnabled = false;
        ticketUpdateData.aiDeactivatedAt = now;
        ticketUpdateData.handedToManagerAt = now;
        ticketUpdateData.status = 'new';
      } else {
        ticketUpdateData.status = 'waiting_client';
      }

      await tx.ticket.update({
        where: { id: ticketId },
        data: ticketUpdateData,
      });

      if (aiReply.shouldHandoff) {
        const handoffMessage = await tx.message.create({
          data: {
            ticketId,
            content: aiReply.handoffReason
              ? `AI передал диалог менеджеру: ${aiReply.handoffReason}`
              : 'AI передал диалог менеджеру',
            senderType: 'system',
            senderRole: 'system',
            status: 'sent',
            deliveryStatus: 'sent',
            messageType: 'system',
            isInternal: false,
          },
        });

        await tx.ticket.update({
          where: { id: ticketId },
          data: {
            lastMessageAt: handoffMessage.createdAt,
          },
        });
      }

      return {
        model: aiReply.model,
        aiMessage,
        handoffTriggered: aiReply.shouldHandoff,
      };
    });

    if (result.handoffTriggered) {
      void this.pushService
        .getManagerTargetsForTicket(ticketId)
        .then((targets) =>
          this.pushService.sendToProfiles(
            targets,
            {
              title: 'Диалог возвращён менеджеру',
              body: 'AI передал диалог в обычную очередь менеджера.',
              url: `/?ticket=${ticketId}`,
              tag: `ticket-${ticketId}-handoff`,
            },
            'ai_handoffs',
          ),
        )
        .catch((error) =>
          console.error(
            'Ошибка push-уведомления при возврате диалога менеджеру:',
            error,
          ),
        );
    }

    return result;
  }
}
