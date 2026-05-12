import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiTextClient } from '../ai-text-client';
import { PrismaService } from '../prisma.service';

type AiAnalysisPayload = {
  topicCategory: string;
  sentiment: string;
  aiSummary: string;
  aiTags: string[];
  insightFlags: string[];
};

type InsightsAiPayload = {
  executiveSummary: string;
  triggerThemes: Array<{
    theme: string;
    count: number;
    explanation: string;
  }>;
  recommendations: string[];
};

type ReasonsAiPayload = {
  executiveSummary: string;
  categories: Array<{
    category: string;
    count: number;
    share: number;
    explanation: string;
    examples: string[];
  }>;
  recommendations: string[];
};

type DateRangeInput = {
  preset?: string;
  dateFrom?: string;
  dateTo?: string;
};

@Injectable()
export class AdminAiService {
  private readonly aiClient: AiTextClient;

  constructor(private readonly prisma: PrismaService) {
    this.aiClient = new AiTextClient('admin');
  }

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

    const days = preset === 'month' ? 30 : 7;

    return {
      from: new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000),
      to: now,
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

  private normalizeStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, 8);
  }

  private normalizeInsightsPayload(value: unknown): InsightsAiPayload {
    if (!value || typeof value !== 'object') {
      return {
        executiveSummary: 'AI не смог подготовить сводку.',
        triggerThemes: [],
        recommendations: [],
      };
    }

    const payload = value as Partial<InsightsAiPayload>;

    return {
      executiveSummary:
        typeof payload.executiveSummary === 'string'
          ? payload.executiveSummary.trim()
          : 'AI не смог подготовить сводку.',
      triggerThemes: Array.isArray(payload.triggerThemes)
        ? payload.triggerThemes
            .map((item) => ({
              theme:
                typeof item?.theme === 'string'
                  ? item.theme.trim()
                  : 'Без названия',
              count: typeof item?.count === 'number' ? item.count : 0,
              explanation:
                typeof item?.explanation === 'string'
                  ? item.explanation.trim()
                  : '',
            }))
            .filter((item) => item.theme)
            .slice(0, 6)
        : [],
      recommendations: this.normalizeStringArray(payload.recommendations).slice(
        0,
        5,
      ),
    };
  }

  private normalizeReasonsPayload(value: unknown): ReasonsAiPayload {
    if (!value || typeof value !== 'object') {
      return {
        executiveSummary: 'AI не смог подготовить анализ причин.',
        categories: [],
        recommendations: [],
      };
    }

    const payload = value as Partial<ReasonsAiPayload>;

    return {
      executiveSummary:
        typeof payload.executiveSummary === 'string'
          ? payload.executiveSummary.trim()
          : 'AI не смог подготовить анализ причин.',
      categories: Array.isArray(payload.categories)
        ? payload.categories
            .map((item) => ({
              category:
                typeof item?.category === 'string'
                  ? item.category.trim()
                  : 'Другое',
              count: typeof item?.count === 'number' ? item.count : 0,
              share: typeof item?.share === 'number' ? item.share : 0,
              explanation:
                typeof item?.explanation === 'string'
                  ? item.explanation.trim()
                  : '',
              examples: this.normalizeStringArray(item?.examples).slice(0, 3),
            }))
            .filter((item) => item.category)
            .slice(0, 8)
        : [],
      recommendations: this.normalizeStringArray(payload.recommendations).slice(
        0,
        5,
      ),
    };
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

  private parseAnalysis(text: string): AiAnalysisPayload {
    try {
      const parsed = JSON.parse(
        this.extractJson(text),
      ) as Partial<AiAnalysisPayload>;

      return {
        topicCategory: parsed.topicCategory?.trim() || 'Без категории',
        sentiment: parsed.sentiment?.trim() || 'neutral',
        aiSummary: parsed.aiSummary?.trim() || 'Сводка не сформирована',
        aiTags: this.normalizeStringArray(parsed.aiTags),
        insightFlags: this.normalizeStringArray(parsed.insightFlags),
      };
    } catch {
      throw new InternalServerErrorException(
        'AI вернул ответ, который не удалось разобрать как JSON.',
      );
    }
  }

  private parseInsightsSummary(text: string): InsightsAiPayload {
    try {
      const parsed = JSON.parse(this.extractJson(text));
      return this.normalizeInsightsPayload(parsed);
    } catch {
      throw new InternalServerErrorException(
        'AI вернул ответ по инсайтам, который не удалось разобрать как JSON.',
      );
    }
  }

  private parseReasonsSummary(text: string): ReasonsAiPayload {
    try {
      const parsed = JSON.parse(this.extractJson(text));
      return this.normalizeReasonsPayload(parsed);
    } catch {
      throw new InternalServerErrorException(
        'AI вернул ответ по причинам, который не удалось разобрать как JSON.',
      );
    }
  }

  private buildPrompt(dialog: {
    id: string;
    title: string;
    status: string;
    clientName: string | null;
    assignedManagerName: string | null;
    supplierName: string | null;
    messages: Array<{
      senderRole: string | null;
      senderType: string;
      content: string;
      createdAt: Date;
    }>;
    supplierRequests: Array<{
      supplierName: string;
      status: string;
      requestText: string;
      createdAt: Date;
      firstResponseAt: Date | null;
    }>;
  }) {
    const transcript = dialog.messages
      .slice(-80)
      .map(
        (message) =>
          `[${message.createdAt.toISOString()}] ${message.senderRole ?? message.senderType}: ${message.content}`,
      )
      .join('\n');

    const supplierContext = dialog.supplierRequests.length
      ? dialog.supplierRequests
          .map(
            (request) =>
              `Поставщик: ${request.supplierName}; статус: ${request.status}; запрос: ${request.requestText}; первый ответ: ${request.firstResponseAt?.toISOString() ?? 'нет'}`,
          )
          .join('\n')
      : 'Запросы поставщику отсутствуют.';

    return `
Ты анализируешь диалог клиентской support/chat-системы TouchSpace для админки.

Верни строго JSON без пояснений и без markdown:
{
  "topicCategory": "короткая категория обращения",
  "sentiment": "positive|neutral|negative|mixed",
  "aiSummary": "краткая сводка на русском языке, 2-4 предложения",
  "aiTags": ["тег1", "тег2"],
  "insightFlags": ["флаг1", "флаг2"]
}

Правила:
- Пиши всё на русском.
- topicCategory должен быть коротким и понятным для B2B-админки.
- aiTags: 2-6 коротких тегов.
- insightFlags: только важные сигналы для админа, например "риск SLA", "нужна эскалация", "негатив клиента", "повторное обращение".
- Если сигналов нет, верни пустой массив.

Метаданные диалога:
- ID: ${dialog.id}
- Заголовок: ${dialog.title}
- Статус: ${dialog.status}
- Клиент: ${dialog.clientName ?? 'не указан'}
- Менеджер: ${dialog.assignedManagerName ?? 'не указан'}
- Поставщик: ${dialog.supplierName ?? 'не указан'}

Контекст запросов поставщику:
${supplierContext}

История сообщений:
${transcript}
`.trim();
  }

  async analyzeDialog(id: string) {
    const dialog = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        messages: {
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            senderRole: true,
            senderType: true,
            content: true,
            createdAt: true,
          },
        },
        supplierRequests: {
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            supplierName: true,
            status: true,
            requestText: true,
            createdAt: true,
            firstResponseAt: true,
          },
        },
      },
    });

    if (!dialog) {
      throw new NotFoundException(`Dialog with id "${id}" not found`);
    }

    const parsed = this.parseAnalysis(
      await this.aiClient.generateText(this.buildPrompt(dialog)),
    );

    const updatedTicket = await this.prisma.ticket.update({
      where: { id },
      data: {
        topicCategory: parsed.topicCategory,
        sentiment: parsed.sentiment,
        aiSummary: parsed.aiSummary,
        aiTags: parsed.aiTags,
        insightFlags: parsed.insightFlags,
      },
    });

    return {
      ticketId: updatedTicket.id,
      model: this.aiClient.model,
      provider: this.aiClient.provider,
      analysis: parsed,
    };
  }

  async generateInsightsSummary(input?: {
    preset?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const now = new Date();
    const preset = input?.preset?.trim() || 'month';
    const to = input?.dateTo ? new Date(input.dateTo) : now;
    const from = input?.dateFrom
      ? new Date(input.dateFrom)
      : new Date(
          now.getTime() -
            (preset === 'day' ? 1 : preset === 'week' ? 7 : 30) *
              24 *
              60 *
              60 *
              1000,
        );

    const tickets = await this.prisma.ticket.findMany({
      where: {
        createdAt: {
          gte: from,
          lte: to,
        },
      },
      include: {
        messages: {
          select: {
            content: true,
            senderRole: true,
            senderType: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
          take: 12,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 80,
    });

    const compactTickets = tickets.map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      topicCategory: ticket.topicCategory,
      sentiment: ticket.sentiment,
      firstResponseTime: ticket.firstResponseTime,
      messages: ticket.messages.map((message) => ({
        role: message.senderRole ?? message.senderType,
        createdAt: message.createdAt.toISOString(),
        content: message.content,
      })),
    }));

    const text = await this.aiClient.generateText(
      `
Ты анализируешь обращения в TouchSpace admin analytics.

Верни строго JSON без markdown:
{
  "executiveSummary": "краткая сводка на русском, 3-5 предложений",
  "triggerThemes": [
    {
      "theme": "короткая тема",
      "count": 12,
      "explanation": "что именно люди спрашивали"
    }
  ],
  "recommendations": ["короткая рекомендация 1", "короткая рекомендация 2"]
}

Правила:
- Пиши только на русском.
- Выделяй повторяющиеся триггеры обращений: сроки, доставка, ламинат, наличие, рекламации и т.п.
- Если видишь сезонный/поведенческий паттерн, упомяни это в executiveSummary.
- triggerThemes ограничь 3-6 элементами.
- recommendations ограничь 2-5 пунктами.

Период:
- с ${from.toISOString()}
- по ${to.toISOString()}

Данные:
${JSON.stringify(compactTickets)}
      `.trim(),
    );

    return {
      period: {
        from,
        to,
        preset,
      },
      model: this.aiClient.model,
      provider: this.aiClient.provider,
      insights: this.parseInsightsSummary(text),
    };
  }

  async generateReasonsSummary(input?: DateRangeInput) {
    const range = this.normalizeDateRange(input);
    const tickets = await this.prisma.ticket.findMany({
      where: {
        conversationMode: {
          not: 'direct_supplier',
        },
        createdAt: {
          gte: range.from,
          lte: range.to,
        },
      },
      include: {
        messages: {
          where: {
            senderType: {
              in: ['client', 'manager', 'supplier'],
            },
          },
          select: {
            senderType: true,
            content: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
          take: 12,
        },
        supplierRequests: {
          select: {
            supplierName: true,
            requestText: true,
            status: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
          take: 5,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 120,
    });

    const compactTickets = tickets.map((ticket) => ({
      title: ticket.title,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      client: ticket.tradePointName || ticket.clientName || null,
      topicCategory: ticket.topicCategory,
      supplier: ticket.supplierName,
      messages: ticket.messages.map((message) => ({
        role: message.senderType,
        createdAt: message.createdAt.toISOString(),
        content: message.content.slice(0, 600),
      })),
      supplierRequests: ticket.supplierRequests.map((request) => ({
        supplierName: request.supplierName,
        status: request.status,
        requestText: request.requestText.slice(0, 500),
        createdAt: request.createdAt.toISOString(),
      })),
    }));

    const text = await this.aiClient.generateText(
      `
Ты анализируешь причины обращений в TouchSpace для администратора.

Верни строго JSON без markdown:
{
  "executiveSummary": "краткая сводка на русском, 2-4 предложения",
  "categories": [
    {
      "category": "Сроки",
      "count": 5,
      "share": 35.7,
      "explanation": "что именно спрашивали или где возникала проблема",
      "examples": ["пример формулировки клиента", "пример 2"]
    }
  ],
  "recommendations": ["короткая рекомендация 1", "короткая рекомендация 2"]
}

Правила:
- Пиши только на русском.
- Сгруппируй похожие обращения в понятные категории: сроки, оплата, доставка, наличие товара, вопрос по товару, документы, рекламация, поставщик, другое.
- count оценивай по количеству диалогов, относящихся к категории.
- share указывай в процентах от всех проанализированных диалогов.
- examples должны быть короткими фразами из сообщений или близкими пересказами.
- categories ограничь 4-8 пунктами.
- Если данных мало, честно напиши это в executiveSummary.

Период:
- с ${range.from.toISOString()}
- по ${range.to.toISOString()}

Данные:
${JSON.stringify(compactTickets)}
      `.trim(),
    );

    return {
      period: range,
      sourceDialogs: tickets.length,
      model: this.aiClient.model,
      provider: this.aiClient.provider,
      reasons: this.parseReasonsSummary(text),
    };
  }

  async generateClientDialogSummary(id: string, input?: DateRangeInput) {
    const dialog = await this.prisma.ticket.findUnique({
      where: { id },
    });

    if (!dialog) {
      throw new NotFoundException(`Dialog with id "${id}" not found`);
    }

    const range = this.normalizeDateRange(input);
    const tickets = await this.prisma.ticket.findMany({
      where: {
        AND: [
          this.buildClientDialogWhere(dialog),
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
        messages: {
          select: {
            senderType: true,
            senderRole: true,
            content: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'asc',
          },
          take: 20,
        },
        supplierRequests: {
          select: {
            supplierName: true,
            status: true,
            requestText: true,
            responseBreached: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 40,
    });

    const compactTickets = tickets.map((ticket) => ({
      title: ticket.title,
      status: ticket.status,
      createdAt: ticket.createdAt.toISOString(),
      manager: ticket.assignedManagerName,
      supplier: ticket.supplierName,
      managerSlaBreached: ticket.slaBreached || ticket.firstResponseBreached,
      supplierSlaBreaches: ticket.supplierRequests.filter(
        (request) => request.responseBreached,
      ).length,
      supplierRequests: ticket.supplierRequests.map((request) => ({
        supplierName: request.supplierName,
        status: request.status,
        requestText: request.requestText,
        responseBreached: request.responseBreached,
        createdAt: request.createdAt.toISOString(),
      })),
      messages: ticket.messages.map((message) => ({
        role: message.senderRole ?? message.senderType,
        createdAt: message.createdAt.toISOString(),
        content: message.content,
      })),
    }));

    const text = await this.aiClient.generateText(
      `
Ты анализируешь историю обращений одного клиента TouchSpace для администратора.

Верни строго JSON без markdown:
{
  "executiveSummary": "краткая сводка на русском, 3-5 предложений",
  "triggerThemes": [
    {
      "theme": "короткая тема",
      "count": 2,
      "explanation": "что именно повторяется у клиента"
    }
  ],
  "recommendations": ["короткая рекомендация 1", "короткая рекомендация 2"]
}

Правила:
- Пиши только на русском.
- Сфокусируйся на повторных обращениях клиента, поставщиках, SLA, причинах эскалаций и управленческих действиях.
- recommendations должны быть практичными для администратора.
- Если данных мало, честно напиши, что устойчивый паттерн пока не виден.

Клиент:
${dialog.clientName || dialog.tradePointName || dialog.clientEmail || dialog.currentUserEmail || 'не указан'}

Период:
- с ${range.from.toISOString()}
- по ${range.to.toISOString()}

Данные:
${JSON.stringify(compactTickets)}
      `.trim(),
    );

    return {
      period: range,
      model: this.aiClient.model,
      provider: this.aiClient.provider,
      insights: this.parseInsightsSummary(text),
    };
  }
}
