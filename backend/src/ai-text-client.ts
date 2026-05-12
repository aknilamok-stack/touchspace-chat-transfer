import { InternalServerErrorException } from '@nestjs/common';
import OpenAI from 'openai';

type AiProvider = 'openai' | 'deepseek';
type AiPurpose = 'admin' | 'chat';

const readProvider = (): AiProvider =>
  process.env.AI_PROVIDER?.trim().toLowerCase() === 'deepseek'
    ? 'deepseek'
    : 'openai';

const readModel = (provider: AiProvider, purpose: AiPurpose) => {
  if (provider === 'deepseek') {
    return (
      (purpose === 'chat'
        ? process.env.DEEPSEEK_CHAT_MODEL?.trim()
        : process.env.DEEPSEEK_ADMIN_MODEL?.trim()) ||
      process.env.DEEPSEEK_ADMIN_MODEL?.trim() ||
      process.env.DEEPSEEK_CHAT_MODEL?.trim() ||
      'deepseek-chat'
    );
  }

  return (
    (purpose === 'chat'
      ? process.env.OPENAI_CHAT_MODEL?.trim()
      : process.env.OPENAI_ADMIN_MODEL?.trim()) ||
    process.env.OPENAI_ADMIN_MODEL?.trim() ||
    process.env.OPENAI_CHAT_MODEL?.trim() ||
    'gpt-5-mini'
  );
};

export class AiTextClient {
  readonly provider: AiProvider;
  readonly model: string;
  private readonly client: OpenAI | null;

  constructor(private readonly purpose: AiPurpose) {
    this.provider = readProvider();
    this.model = readModel(this.provider, purpose);

    const apiKey =
      this.provider === 'deepseek'
        ? process.env.DEEPSEEK_API_KEY?.trim()
        : process.env.OPENAI_API_KEY?.trim();

    this.client = apiKey
      ? new OpenAI({
          apiKey,
          ...(this.provider === 'deepseek'
            ? {
                baseURL:
                  process.env.DEEPSEEK_BASE_URL?.trim() ||
                  'https://api.deepseek.com',
              }
            : {}),
        })
      : null;
  }

  private ensureClient() {
    if (!this.client) {
      const envName =
        this.provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY';

      throw new InternalServerErrorException(
        `${envName} не задан. Добавьте ключ в окружение backend.`,
      );
    }

    return this.client;
  }

  async generateText(input: string) {
    const client = this.ensureClient();

    if (this.provider === 'deepseek') {
      const response = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: input }],
        response_format: { type: 'json_object' },
        temperature: this.purpose === 'chat' ? 0.3 : 0.2,
      });

      const text = response.choices[0]?.message?.content?.trim();

      if (!text) {
        throw new InternalServerErrorException(
          'DeepSeek вернул пустой AI-ответ.',
        );
      }

      return text;
    }

    const response = await client.responses.create({
      model: this.model,
      input,
    });

    return response.output_text;
  }
}
