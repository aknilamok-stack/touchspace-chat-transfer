import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MessagesService } from '../messages/messages.service';
import { EmailService } from './email.service';

@Injectable()
export class EmailPollingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailPollingService.name);
  private pollingTimer: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messagesService: MessagesService,
    private readonly emailService: EmailService,
  ) {}

  onModuleInit() {
    this.emailService.logStartupStatus();

    if (!this.emailService.isImapEnabled()) {
      return;
    }

    this.logger.log(
      `Starting IMAP polling every ${Math.round(this.emailService.getPollingIntervalMs() / 1000)}s`,
    );

    void this.pollInbox();
    this.pollingTimer = setInterval(() => {
      void this.pollInbox();
    }, this.emailService.getPollingIntervalMs());
  }

  onModuleDestroy() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private async pollInbox() {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;

    if (this.emailService.isImapNtlmEnabled()) {
      try {
        await this.pollInboxViaNtlm();
      } catch (error) {
        this.logger.error(
          'IMAP NTLM polling failed',
          error instanceof Error ? error.stack : undefined,
        );
      } finally {
        this.isPolling = false;
      }

      return;
    }

    const client = this.emailService.getImapClient();

    try {
      await client.connect();

      const lock = await client.getMailboxLock('INBOX');

      try {
        const unreadUids = await client.search({ seen: false }, { uid: true });
        const normalizedUids = Array.isArray(unreadUids)
          ? unreadUids.sort((left, right) => left - right)
          : [];

        if (normalizedUids.length === 0) {
          return;
        }

        this.logger.log(
          `Found ${normalizedUids.length} unread email(s) in inbox`,
        );

        const processedUids: number[] = [];

        for await (const message of client.fetch(
          normalizedUids,
          {
            uid: true,
            envelope: true,
            source: true,
          },
          { uid: true },
        )) {
          if (!message.uid || !message.source) {
            continue;
          }

          const processed = await this.processIncomingMessage({
            uid: message.uid,
            source: Buffer.isBuffer(message.source)
              ? message.source
              : Buffer.from(message.source),
          });

          if (processed) {
            processedUids.push(message.uid);
          }
        }

        await this.emailService.markMailboxMessagesSeen(client, processedUids);
      } finally {
        lock.release();
      }
    } catch (error) {
      this.logger.error(
        'IMAP polling failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isPolling = false;
      await client.logout().catch(() => undefined);
    }
  }

  private async pollInboxViaNtlm() {
    const client = this.emailService.createImapNtlmClient();

    try {
      await client.connect();
      await client.authenticate();
      await client.selectInbox();

      const unreadUids = await client.searchUnreadUids();
      const normalizedUids = unreadUids.sort((left, right) => left - right);

      if (normalizedUids.length === 0) {
        return;
      }

      this.logger.log(
        `Found ${normalizedUids.length} unread email(s) in inbox`,
      );

      const processedUids: number[] = [];

      for (const uid of normalizedUids) {
        const source = await client.fetchMessageSourceByUid(uid);

        if (!source) {
          continue;
        }

        const processed = await this.processIncomingMessage({
          uid,
          source,
        });

        if (processed) {
          processedUids.push(uid);
        }
      }

      await client.markSeen(processedUids);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private async processIncomingMessage(params: {
    uid: number;
    source: Buffer;
  }) {
    try {
      const parsedMessage = await this.emailService.parseIncomingMessage(
        params.source,
      );
      const messageId = parsedMessage.messageId?.trim();

      if (!messageId) {
        this.logger.warn(
          `Skipping email UID ${params.uid}: messageId is missing`,
        );
        return true;
      }

      const existingMessage = await this.prisma.message.findUnique({
        where: { messageId },
        select: { id: true },
      });

      if (existingMessage) {
        return true;
      }

      const headerCandidates = [
        ...this.emailService.extractHeaderMessageIds(parsedMessage.inReplyTo),
        ...this.emailService.extractHeaderMessageIds(parsedMessage.references),
      ];
      const ticketIdFromHeaders =
        await this.emailService.findTicketIdByHeaders(headerCandidates);
      const ticketId =
        ticketIdFromHeaders ??
        this.emailService.extractTicketIdFromSubject(parsedMessage.subject);

      if (!ticketId) {
        this.logger.warn(
          `Skipping email UID ${params.uid}: unable to match ticket by headers or subject`,
        );
        return true;
      }

      await this.messagesService.create({
        ticketId,
        content: this.emailService.extractTextContent(parsedMessage),
        senderType: 'client',
        messageType: 'email',
        transport: 'email',
        fromEmail: this.emailService.extractPrimaryAddress(parsedMessage.from),
        toEmail: this.emailService.extractPrimaryAddress(parsedMessage.to),
        subject: parsedMessage.subject?.trim() || null,
        messageId,
        inReplyTo:
          this.emailService.extractHeaderMessageIds(
            parsedMessage.inReplyTo,
          )[0] ?? null,
        references:
          this.emailService
            .extractHeaderMessageIds(parsedMessage.references)
            .join(' ') || null,
        clientEmail:
          this.emailService.extractPrimaryAddress(parsedMessage.from) ??
          undefined,
      });

      this.logger.log(
        `Attached incoming email UID ${params.uid} to ticket ${ticketId}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to process incoming email UID ${params.uid}`,
        error instanceof Error ? error.stack : undefined,
      );
      return false;
    }
  }
}
