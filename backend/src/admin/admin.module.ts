import { Module } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { PrismaService } from '../prisma.service';
import { ProfilesService } from '../profiles.service';
import { AdminAiService } from './admin-ai.service';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Module({
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminAiService,
    AdminGuard,
    AuthService,
    PrismaService,
    ProfilesService,
  ],
})
export class AdminModule {}
