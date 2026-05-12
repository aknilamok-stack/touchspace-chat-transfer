import { Injectable } from '@nestjs/common';

type TicketTypingState = {
  clientLastTypingAt?: number;
  managerLastTypingAt?: number;
  clientPreviewText?: string;
};

@Injectable()
export class TypingService {
  private readonly typingState = new Map<string, TicketTypingState>();

  setTyping(ticketId: string, senderType: string, previewText?: string) {
    if (senderType !== 'client' && senderType !== 'manager') {
      return;
    }

    const currentState = this.typingState.get(ticketId) ?? {};

    this.typingState.set(ticketId, {
      ...currentState,
      ...(senderType === 'client'
        ? {
            clientLastTypingAt: Date.now(),
            clientPreviewText:
              typeof previewText === 'string' ? previewText.slice(0, 500) : '',
          }
        : { managerLastTypingAt: Date.now() }),
    });
  }

  clearTyping(ticketId: string, senderType?: string) {
    if (senderType && senderType !== 'client' && senderType !== 'manager') {
      return;
    }

    const currentState = this.typingState.get(ticketId);

    if (!currentState) {
      return;
    }

    if (!senderType || senderType === 'client') {
      delete currentState.clientLastTypingAt;
      delete currentState.clientPreviewText;
    }

    if (!senderType || senderType === 'manager') {
      delete currentState.managerLastTypingAt;
    }

    if (!currentState.clientLastTypingAt && !currentState.managerLastTypingAt) {
      this.typingState.delete(ticketId);
      return;
    }

    this.typingState.set(ticketId, currentState);
  }

  getTyping(ticketId: string) {
    const state = this.typingState.get(ticketId);
    const clientTyping =
      typeof state?.clientLastTypingAt === 'number' &&
      Date.now() - state.clientLastTypingAt < 3000;
    const managerTyping =
      typeof state?.managerLastTypingAt === 'number' &&
      Date.now() - state.managerLastTypingAt < 3000;

    if (!clientTyping && !managerTyping && state) {
      this.typingState.delete(ticketId);
    }

    return {
      clientTyping,
      managerTyping,
      clientPreviewText: clientTyping ? (state?.clientPreviewText ?? '') : '',
    };
  }
}
