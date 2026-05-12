import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import nodemailer, { type Transporter } from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { simpleParser } from 'mailparser';
import { ImapNtlmClient } from './imap-ntlm-client';
import { PrismaService } from '../prisma.service';

type EmailAddressValue =
  | string
  | {
      name?: string | null;
      address?: string | null;
    }
  | null
  | undefined;

type OutboundEmailResult = {
  fromEmail: string;
  toEmail: string;
  subject: string;
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
};

type SmtpAuthMode = 'basic' | 'ntlm';
type ImapAuthMode = 'basic' | 'ntlm';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: Transporter | null;
  private readonly smtpEnabled: boolean;
  private readonly imapEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.smtpEnabled = this.hasSmtpConfig();
    this.imapEnabled = this.hasImapConfig();
    this.transporter = this.smtpEnabled ? this.createSmtpTransport() : null;
  }

  isSmtpEnabled() {
    return this.smtpEnabled;
  }

  isImapEnabled() {
    return this.imapEnabled;
  }

  isImapNtlmEnabled() {
    return this.imapEnabled && this.getImapAuthMode() === 'ntlm';
  }

  getPollingIntervalMs() {
    return 45_000;
  }

  getImapClient() {
    if (!this.imapEnabled) {
      throw new ServiceUnavailableException(
        'IMAP polling is disabled because configuration is incomplete',
      );
    }

    if (this.getImapAuthMode() === 'ntlm') {
      throw new ServiceUnavailableException(
        'IMAP NTLM is not configured in the current mail integration',
      );
    }

    return new ImapFlow({
      host: this.requireEnv('IMAP_HOST'),
      port: this.getNumberEnv('IMAP_PORT', 993),
      secure: this.getBooleanEnv('IMAP_TLS', true),
      auth: {
        user: this.requireEnv('IMAP_USER'),
        pass: this.requireEnv('IMAP_PASS'),
      },
      logger: false,
    });
  }

  createImapNtlmClient() {
    if (!this.isImapNtlmEnabled()) {
      throw new ServiceUnavailableException(
        'IMAP NTLM polling is disabled because configuration is incomplete',
      );
    }

    return new ImapNtlmClient({
      host: this.requireEnv('IMAP_HOST'),
      port: this.getNumberEnv('IMAP_PORT', 993),
      secure: this.getBooleanEnv('IMAP_TLS', true),
      user: this.requireEnv('IMAP_USER'),
      password: this.requireEnv('IMAP_PASS'),
      domain: this.requireEnv('IMAP_NTLM_DOMAIN'),
      workstation:
        this.configService.get<string>('IMAP_NTLM_WORKSTATION')?.trim() ||
        undefined,
    });
  }

  async sendTicketEmail(params: {
    ticketId: string;
    content: string;
    toEmail?: string | null;
  }): Promise<OutboundEmailResult> {
    if (!this.transporter) {
      throw new ServiceUnavailableException(
        'SMTP is disabled because configuration is incomplete',
      );
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: params.ticketId },
      select: {
        id: true,
        title: true,
        clientEmail: true,
        canonicalEmail: true,
        messages: {
          where: {
            transport: 'email',
            messageId: {
              not: null,
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            messageId: true,
            references: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new BadRequestException(
        `Ticket with id "${params.ticketId}" not found`,
      );
    }

    const toEmail = this.normalizeEmail(
      params.toEmail ?? ticket.canonicalEmail ?? ticket.clientEmail,
    );

    if (!toEmail) {
      throw new BadRequestException('Email получателя не указан');
    }

    const latestEmailThread = ticket.messages[0] ?? null;
    const inReplyTo = latestEmailThread?.messageId?.trim() || null;
    const references = this.mergeReferences(
      latestEmailThread?.references,
      latestEmailThread?.messageId,
    );
    const fromEmail = this.requireEnv('SMTP_FROM_EMAIL');
    const subject = this.buildTicketSubject(ticket.title, ticket.id);
    const result = await this.transporter.sendMail({
      from: this.buildFromHeader(),
      to: toEmail,
      subject,
      text: this.buildPlainTextBody(params.content, ticket.id),
      inReplyTo: inReplyTo ?? undefined,
      references: references ?? undefined,
      headers: {
        'X-TouchSpace-Ticket-Id': ticket.id,
      },
    });

    const messageId = result.messageId?.trim();

    if (!messageId) {
      throw new ServiceUnavailableException(
        'SMTP transport did not return messageId',
      );
    }

    return {
      fromEmail,
      toEmail,
      subject,
      messageId,
      inReplyTo,
      references,
    };
  }

  async parseIncomingMessage(source: Buffer) {
    return simpleParser(source);
  }

  extractPrimaryAddress(
    value: {
      value?: Array<{ address?: string | null; name?: string | null }>;
      text?: string;
    } | null,
  ) {
    const address = value?.value?.[0]?.address?.trim().toLowerCase();
    return address || null;
  }

  extractTextContent(
    parsedMessage: Awaited<ReturnType<EmailService['parseIncomingMessage']>>,
  ) {
    const text = this.cleanIncomingReply(
      (parsedMessage.text ?? '').replace(/\r\n/g, '\n'),
    );

    if (text) {
      return text;
    }

    const htmlText = this.cleanIncomingReply(
      (parsedMessage.htmlToText ?? '').replace(/\r\n/g, '\n'),
    );

    return htmlText || '(Пустое письмо)';
  }

  extractHeaderMessageIds(value?: string | string[] | null) {
    if (!value) {
      return [];
    }

    const rawValue = Array.isArray(value) ? value.join(' ') : value;

    return Array.from(
      new Set(
        rawValue
          .match(/<[^>]+>/g)
          ?.map((messageId) => messageId.trim())
          .filter(Boolean) ?? [],
      ),
    );
  }

  extractTicketIdFromSubject(subject?: string | null) {
    const match =
      subject?.match(/\[TouchSpace\s+#ticket_([a-z0-9]+)\]/i) ??
      subject?.match(/\bticket[\s:_-]*([a-z0-9]+)\b/i);

    return match?.[1] ?? null;
  }

  async findTicketIdByHeaders(headerMessageIds: string[]) {
    if (headerMessageIds.length === 0) {
      return null;
    }

    const messages = await this.prisma.message.findMany({
      where: {
        messageId: {
          in: headerMessageIds,
        },
      },
      select: {
        ticketId: true,
        messageId: true,
      },
    });

    for (const headerMessageId of headerMessageIds) {
      const matchedMessage = messages.find(
        (message) => message.messageId === headerMessageId,
      );

      if (matchedMessage) {
        return matchedMessage.ticketId;
      }
    }

    return null;
  }

  async markMailboxMessagesSeen(client: ImapFlow, uids: number[]) {
    if (uids.length === 0) {
      return;
    }

    await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
  }

  logStartupStatus() {
    if (this.smtpEnabled) {
      this.logger.log(
        `SMTP enabled (${this.getSmtpAuthMode()}) for ${this.requireEnv('SMTP_HOST')}:${this.getNumberEnv('SMTP_PORT', 465)}`,
      );
    } else {
      this.logger.warn('SMTP disabled: mail env is incomplete');
    }

    if (this.imapEnabled) {
      this.logger.log(
        `IMAP polling enabled (${this.getImapAuthMode()}) for ${this.requireEnv('IMAP_HOST')}:${this.getNumberEnv('IMAP_PORT', 993)}`,
      );
    } else if (this.getImapAuthMode() === 'ntlm') {
      this.logger.warn(
        'IMAP polling disabled: NTLM mode is not implemented in the current mail integration',
      );
    } else {
      this.logger.warn('IMAP polling disabled: mail env is incomplete');
    }
  }

  private hasSmtpConfig() {
    const requiredKeys = [
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM_EMAIL',
    ];

    if (this.getSmtpAuthMode() === 'ntlm') {
      requiredKeys.push('SMTP_NTLM_DOMAIN');
    }

    return requiredKeys.every((key) =>
      Boolean(this.configService.get<string>(key)?.trim()),
    );
  }

  private hasImapConfig() {
    if (this.getImapAuthMode() === 'ntlm') {
      return [
        'IMAP_HOST',
        'IMAP_PORT',
        'IMAP_USER',
        'IMAP_PASS',
        'IMAP_NTLM_DOMAIN',
      ].every((key) => Boolean(this.configService.get<string>(key)?.trim()));
    }

    return ['IMAP_HOST', 'IMAP_PORT', 'IMAP_USER', 'IMAP_PASS'].every((key) =>
      Boolean(this.configService.get<string>(key)?.trim()),
    );
  }

  private createSmtpTransport() {
    const transportOptions: SMTPTransport.Options = {
      host: this.requireEnv('SMTP_HOST'),
      port: this.getNumberEnv('SMTP_PORT', 465),
      secure: this.getBooleanEnv('SMTP_SECURE', true),
      ...this.buildSmtpAuthOptions(),
    };

    return nodemailer.createTransport(transportOptions);
  }

  private buildSmtpAuthOptions():
    | Pick<SMTPTransport.Options, 'auth'>
    | Pick<SMTPTransport.Options, 'auth' | 'customAuth'> {
    const user = this.requireEnv('SMTP_USER');
    const pass = this.requireEnv('SMTP_PASS');

    if (this.getSmtpAuthMode() !== 'ntlm') {
      return {
        auth: {
          user,
          pass,
        },
      };
    }

    let nodemailerNtlmAuth: unknown;

    try {
      nodemailerNtlmAuth = require('nodemailer-ntlm-auth');
    } catch {
      throw new ServiceUnavailableException(
        'SMTP NTLM requires the "nodemailer-ntlm-auth" package to be installed',
      );
    }

    return {
      auth: {
        type: 'custom',
        method: 'NTLM',
        user,
        pass,
        options: {
          domain: this.requireEnv('SMTP_NTLM_DOMAIN'),
          workstation:
            this.configService.get<string>('SMTP_NTLM_WORKSTATION')?.trim() ||
            undefined,
        },
      },
      customAuth: {
        NTLM: nodemailerNtlmAuth as (
          ctx: unknown,
        ) => Promise<void> | void,
      },
    };
  }

  private getSmtpAuthMode(): SmtpAuthMode {
    const value =
      this.configService.get<string>('SMTP_AUTH_MODE')?.trim().toLowerCase() ||
      'basic';

    return value === 'ntlm' ? 'ntlm' : 'basic';
  }

  private getImapAuthMode(): ImapAuthMode {
    const value =
      this.configService.get<string>('IMAP_AUTH_MODE')?.trim().toLowerCase() ||
      'basic';

    return value === 'ntlm' ? 'ntlm' : 'basic';
  }

  private requireEnv(key: string) {
    const value = this.configService.get<string>(key)?.trim();

    if (!value) {
      throw new ServiceUnavailableException(`${key} is not configured`);
    }

    return value;
  }

  private getNumberEnv(key: string, fallback: number) {
    const value = this.configService.get<string>(key)?.trim();

    if (!value) {
      return fallback;
    }

    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : fallback;
  }

  private getBooleanEnv(key: string, fallback: boolean) {
    const value = this.configService.get<string>(key)?.trim().toLowerCase();

    if (!value) {
      return fallback;
    }

    return ['1', 'true', 'yes', 'on'].includes(value);
  }

  private normalizeEmail(value?: string | null) {
    const normalizedValue = value?.trim().toLowerCase();

    if (!normalizedValue) {
      return null;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(normalizedValue)) {
      throw new BadRequestException('Некорректный email получателя');
    }

    return normalizedValue;
  }

  private buildFromHeader(): Mail.Address | string {
    const address = this.requireEnv('SMTP_FROM_EMAIL');
    const name = this.configService.get<string>('SMTP_FROM_NAME')?.trim();

    if (!name) {
      return address;
    }

    return {
      address,
      name,
    };
  }

  private buildTicketSubject(_ticketTitle: string | null, _ticketId: string) {
    return 'Оператор TouchSpace';
  }

  private buildPlainTextBody(content: string, _ticketId: string) {
    return [
      content.trim(),
      '',
      'С уважением,',
      'Оператор TouchSpace',
    ].join('\n');
  }

  private cleanIncomingReply(rawText: string) {
    const normalizedText = rawText
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .trim();

    if (!normalizedText) {
      return '';
    }

    const lines = normalizedText.split('\n');
    const cleanedLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const normalizedLine = line.trim();

      if (this.isReplyBoundaryLine(normalizedLine)) {
        break;
      }

      if (this.isQuotedLine(normalizedLine)) {
        break;
      }

      if (this.isSignatureLine(normalizedLine)) {
        continue;
      }

      cleanedLines.push(line);
    }

    return cleanedLines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private isQuotedLine(line: string) {
    return /^>+/.test(line);
  }

  private isReplyBoundaryLine(line: string) {
    if (!line) {
      return false;
    }

    return (
      /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday),?.+\bwrote:$/i.test(
        line,
      ) ||
      /^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье),?.+\bот\s.+:\s*$/i.test(
        line,
      ) ||
      /^On .+wrote:$/i.test(line) ||
      /^.+\s+at\s+.+\s+.+<[^>]+>:\s*$/i.test(line) ||
      /^.+\s+в\s+.+\s+от\s+.+<[^>]+>:\s*$/i.test(line) ||
      /^From:\s.+$/i.test(line) ||
      /^Sent:\s.+$/i.test(line) ||
      /^Subject:\s.+$/i.test(line) ||
      /^To:\s.+$/i.test(line) ||
      /^От:\s.+$/i.test(line) ||
      /^Тема:\s.+$/i.test(line) ||
      /^Кому:\s.+$/i.test(line) ||
      /^Дата:\s.+$/i.test(line) ||
      /^-+\s*Original Message\s*-+$/i.test(line) ||
      /^TouchSpace ticket:\s.+$/i.test(line) ||
      /^_{3,}$/.test(line) ||
      /^-{3,}$/.test(line)
    );
  }

  private isSignatureLine(line: string) {
    if (!line) {
      return false;
    }

    return (
      /^Sent from my /i.test(line) ||
      /^Get Outlook for /i.test(line) ||
      /^Отправлено с iPhone$/i.test(line) ||
      /^Отправлено с iPad$/i.test(line) ||
      /^Отправлено с Android$/i.test(line) ||
      /^Отправлено из мобильной Почты Mail$/i.test(line) ||
      /^Отправлено из мобильной Яндекс Почты$/i.test(line) ||
      /^Отправлено из приложения Почта$/i.test(line)
    );
  }

  private mergeReferences(
    referencesValue?: string | null,
    messageIdValue?: string | null,
  ) {
    const mergedValues = new Set<string>([
      ...this.extractHeaderMessageIds(referencesValue),
      ...this.extractHeaderMessageIds(messageIdValue),
    ]);

    if (mergedValues.size === 0) {
      return null;
    }

    return Array.from(mergedValues).join(' ');
  }
}
