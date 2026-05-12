import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('settings')
  getSettings(
    @Query('profileId') profileId: string,
    @Query('role') role: string,
  ) {
    return this.notificationsService.getSettings(profileId, role);
  }

  @Get('manager-candidates')
  getManagerNotificationCandidates(@Query('profileId') profileId: string) {
    return this.notificationsService.getManagerNotificationCandidates(
      profileId,
    );
  }

  @Get('supplier-candidates')
  getSupplierNotificationCandidates(
    @Query('profileId') profileId: string,
    @Query('supplierId') supplierId?: string,
  ) {
    return this.notificationsService.getSupplierNotificationCandidates(
      profileId,
      supplierId,
    );
  }

  @Patch('preferences')
  updatePreferences(
    @Body()
    body: {
      profileId: string;
      role: string;
      notificationPushEnabled?: boolean;
      notifyClientChats?: boolean;
      notifySupplierChats?: boolean;
      notifySupplierRequests?: boolean;
      notifyAiHandoffs?: boolean;
      notifyAdminAlerts?: boolean;
    },
  ) {
    return this.notificationsService.updatePreferences(
      body.profileId,
      body.role,
      body,
    );
  }

  @Post('subscriptions/:id/deactivate')
  deactivateDevice(
    @Param('id') id: string,
    @Body()
    body: {
      profileId: string;
    },
  ) {
    return this.notificationsService.deactivateDevice(body.profileId, id);
  }
}
