import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('public-key')
  getPublicKey() {
    return this.pushService.getPublicKey();
  }

  @Post('subscriptions')
  saveSubscription(
    @Body()
    body: {
      profileId: string;
      role: string;
      endpoint: string;
      keys: {
        p256dh: string;
        auth: string;
      };
      userAgent?: string;
      deviceLabel?: string;
    },
  ) {
    return this.pushService.saveSubscription(body);
  }

  @Delete('subscriptions')
  deleteSubscription(
    @Body()
    body: {
      endpoint: string;
    },
  ) {
    return this.pushService.deactivateSubscription(body.endpoint);
  }

  @Post('test')
  sendTest(
    @Body()
    body: {
      profileId: string;
      role: string;
    },
  ) {
    return this.pushService.sendTestNotification(body.profileId, body.role);
  }
}
