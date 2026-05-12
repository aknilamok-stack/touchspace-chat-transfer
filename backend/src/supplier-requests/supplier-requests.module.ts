import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProfilesService } from '../profiles.service';
import { PushService } from '../push.service';
import { SupplierRequestsController } from './supplier-requests.controller';
import { SupplierRequestsService } from './supplier-requests.service';

@Module({
  controllers: [SupplierRequestsController],
  providers: [
    SupplierRequestsService,
    PrismaService,
    ProfilesService,
    PushService,
  ],
  exports: [SupplierRequestsService],
})
export class SupplierRequestsModule {}
