import net from 'node:net';
import tls from 'node:tls';
import {
  createType1Message,
  createType3Message,
  parseType2Message,
} from '@node-ntlm/core';

type ImapNtlmClientOptions = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  domain: string;
  workstation?: string;
};

type ImapCommandResponse = {
  lines: string[];
  literals: Buffer[];
};

export class ImapNtlmClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = Buffer.alloc(0);
  private tagCounter = 0;
  private ended = false;
  private pendingResolver: (() => void) | null = null;

  constructor(private readonly options: ImapNtlmClientOptions) {}

  async connect() {
    this.socket = this.options.secure
      ? tls.connect({
          host: this.options.host,
          port: this.options.port,
          servername: this.options.host,
        })
      : net.connect({
          host: this.options.host,
          port: this.options.port,
        });

    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.pendingResolver?.();
      this.pendingResolver = null;
    });

    this.socket.on('error', (error) => {
      this.ended = true;
      this.pendingResolver?.();
      this.pendingResolver = null;
      if (!this.socket?.destroyed) {
        this.socket?.destroy(error);
      }
    });

    this.socket.on('close', () => {
      this.ended = true;
      this.pendingResolver?.();
      this.pendingResolver = null;
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('IMAP socket was not created'));
        return;
      }

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const onConnect = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        this.socket?.off('error', onError);
        this.socket?.off('connect', onConnect);
        if (this.socket instanceof tls.TLSSocket) {
          this.socket.off('secureConnect', onConnect);
        }
      };

      this.socket.once('error', onError);

      if (this.socket instanceof tls.TLSSocket) {
        this.socket.once('secureConnect', onConnect);
      } else {
        this.socket.once('connect', onConnect);
      }
    });

    const greeting = await this.readLine();

    if (!/^\*\s+OK\b/i.test(greeting)) {
      throw new Error(`Unexpected IMAP greeting: ${greeting}`);
    }
  }

  async authenticate() {
    const tag = this.nextTag();
    this.writeLine(`${tag} AUTHENTICATE NTLM`);

    const firstContinuation = await this.readLine();

    if (!/^\+/.test(firstContinuation)) {
      throw new Error(`NTLM auth was not accepted by IMAP server: ${firstContinuation}`);
    }

    const type1Message = createType1Message({
      domain: this.options.domain,
      workstation: this.options.workstation || '',
    }).replace(/^NTLM\s+/i, '');

    this.writeLine(type1Message);

    const type2Response = await this.readLine();

    if (!/^\+/.test(type2Response)) {
      throw new Error(`IMAP server did not return NTLM challenge: ${type2Response}`);
    }

    const type2Message = type2Response.replace(/^\+\s*/, '').trim();

    if (!type2Message) {
      throw new Error('IMAP server returned an empty NTLM challenge');
    }

    const type3Message = createType3Message(
      parseType2Message(`NTLM ${type2Message}`),
      {
        domain: this.options.domain,
        workstation: this.options.workstation || '',
        username: this.options.user,
        password: this.options.password,
      },
    ).replace(/^NTLM\s+/i, '');

    this.writeLine(type3Message);

    const response = await this.readCommandResponse(tag);
    this.assertTaggedOk(response.lines.at(-1), 'AUTHENTICATE NTLM');
  }

  async selectInbox() {
    const response = await this.runCommand('SELECT INBOX');
    this.assertTaggedOk(response.lines.at(-1), 'SELECT INBOX');
  }

  async searchUnreadUids() {
    const response = await this.runCommand('UID SEARCH UNSEEN');
    this.assertTaggedOk(response.lines.at(-1), 'UID SEARCH UNSEEN');

    const searchLine = response.lines.find((line) => /^\*\s+SEARCH\b/i.test(line));

    if (!searchLine) {
      return [];
    }

    return searchLine
      .replace(/^\*\s+SEARCH\s*/i, '')
      .trim()
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  async fetchMessageSourceByUid(uid: number) {
    const response = await this.runCommand(`UID FETCH ${uid} (UID RFC822)`);
    this.assertTaggedOk(response.lines.at(-1), `UID FETCH ${uid}`);
    return response.literals[0] ?? null;
  }

  async markSeen(uids: number[]) {
    if (uids.length === 0) {
      return;
    }

    const response = await this.runCommand(
      `UID STORE ${uids.join(',')} +FLAGS.SILENT (\\Seen)`,
    );
    this.assertTaggedOk(response.lines.at(-1), 'UID STORE');
  }

  async logout() {
    if (!this.socket || this.socket.destroyed) {
      return;
    }

    try {
      const response = await this.runCommand('LOGOUT');
      this.assertTaggedOk(response.lines.at(-1), 'LOGOUT');
    } finally {
      this.socket.end();
      this.socket.destroy();
      this.socket = null;
    }
  }

  private async runCommand(command: string) {
    const tag = this.nextTag();
    this.writeLine(`${tag} ${command}`);
    return this.readCommandResponse(tag);
  }

  private async readCommandResponse(tag: string): Promise<ImapCommandResponse> {
    const lines: string[] = [];
    const literals: Buffer[] = [];

    while (true) {
      const line = await this.readLine();
      lines.push(line);

      const literalMatch = line.match(/\{(\d+)\}$/);

      if (literalMatch) {
        const literalSize = Number(literalMatch[1]);
        const literal = await this.readBytes(literalSize);
        literals.push(literal);
        await this.readBytes(2);
      }

      if (new RegExp(`^${tag}\\s`, 'i').test(line)) {
        return { lines, literals };
      }
    }
  }

  private assertTaggedOk(line: string | undefined, command: string) {
    if (!line || !/\sOK\b/i.test(line)) {
      throw new Error(`IMAP command failed for ${command}: ${line || 'empty response'}`);
    }
  }

  private writeLine(value: string) {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('IMAP socket is not connected');
    }

    this.socket.write(`${value}\r\n`);
  }

  private async readLine() {
    while (true) {
      const lineEndIndex = this.buffer.indexOf('\r\n');

      if (lineEndIndex >= 0) {
        const lineBuffer = this.buffer.subarray(0, lineEndIndex);
        this.buffer = this.buffer.subarray(lineEndIndex + 2);
        return lineBuffer.toString('utf8');
      }

      await this.waitForMoreData();
    }
  }

  private async readBytes(size: number) {
    while (this.buffer.length < size) {
      await this.waitForMoreData();
    }

    const value = this.buffer.subarray(0, size);
    this.buffer = this.buffer.subarray(size);
    return value;
  }

  private async waitForMoreData() {
    if (this.ended) {
      throw new Error('IMAP socket closed unexpectedly');
    }

    await new Promise<void>((resolve) => {
      this.pendingResolver = resolve;
    });
  }

  private nextTag() {
    this.tagCounter += 1;
    return `A${String(this.tagCounter).padStart(4, '0')}`;
  }
}
