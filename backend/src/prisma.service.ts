import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined');
    }

    const databaseUrl = new URL(connectionString);
    const host = process.env.DATABASE_HOST?.trim() || databaseUrl.hostname;
    const port = Number(
      process.env.DATABASE_PORT?.trim() || databaseUrl.port || '3306',
    );
    const user =
      process.env.DATABASE_USER?.trim() ||
      decodeURIComponent(databaseUrl.username);
    const password =
      process.env.DATABASE_PASSWORD ?? decodeURIComponent(databaseUrl.password);
    const database =
      process.env.DATABASE_NAME?.trim() ||
      databaseUrl.pathname.replace(/^\//, '');

    if (!host || !user || !database || Number.isNaN(port)) {
      throw new Error('Database adapter configuration is incomplete');
    }

    const adapter = new PrismaMariaDb({
      host,
      port,
      user,
      password,
      database,
    });

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
