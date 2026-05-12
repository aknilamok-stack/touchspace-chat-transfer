import { Injectable, Logger } from '@nestjs/common';
import webpush from 'web-push';
import { ProfilesService } from './profiles.service';
import { PrismaService } from './prisma.service';
import { readJsonStringArray } from './prisma-json.util';
import { getDefaultFullNameForRole, MANAGER_ROLES, SUPPLIER_ROLES } from './role.utils';

type StoredSubscriptionInput = {
  profileId: string;
  role: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string | null;
  deviceLabel?: string | null;
};

type NotificationPayload = {
  title: string;
  body: string;
  url: string;
  icon?: string;
  badge?: string;
  tag?: string;
};

export type NotificationEventType =
  | 'client_chats'
  | 'supplier_chats'
  | 'supplier_requests'
  | 'ai_handoffs'
  | 'admin_alerts';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly publicKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly profilesService: ProfilesService,
  ) {
    this.publicKey = process.env.WEB_PUSH_PUBLIC_KEY?.trim() || '';
    const privateKey = process.env.WEB_PUSH_PRIVATE_KEY?.trim() || '';
    const subject =
      process.env.WEB_PUSH_SUBJECT?.trim() || 'mailto:touchspace@example.com';

    if (this.publicKey && privateKey) {
      webpush.setVapidDetails(subject, this.publicKey, privateKey);
    }
  }

  getPublicKey() {
    return {
      publicKey: this.publicKey,
      configured: Boolean(this.publicKey),
    };
  }

  private isEventEnabledForProfile(
    profile: {
      notificationPushEnabled: boolean;
      notifyClientChats: boolean;
      notifySupplierChats: boolean;
      notifySupplierRequests: boolean;
      notifyAiHandoffs: boolean;
      notifyAdminAlerts: boolean;
    },
    eventType: NotificationEventType,
  ) {
    if (!profile.notificationPushEnabled) {
      return false;
    }

    switch (eventType) {
      case 'client_chats':
        return profile.notifyClientChats;
      case 'supplier_chats':
        return profile.notifySupplierChats;
      case 'supplier_requests':
        return profile.notifySupplierRequests;
      case 'ai_handoffs':
        return profile.notifyAiHandoffs;
      case 'admin_alerts':
        return profile.notifyAdminAlerts;
      default:
        return true;
    }
  }

  async saveSubscription(input: StoredSubscriptionInput) {
    await this.profilesService.ensureProfile({
      id: input.profileId,
      role: input.role,
      fullName: getDefaultFullNameForRole(input.role),
    });

    return this.prisma.pushSubscription.upsert({
      where: {
        endpoint: input.endpoint,
      },
      create: {
        profileId: input.profileId,
        role: input.role,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent?.trim() || null,
        deviceLabel: input.deviceLabel?.trim() || null,
        isActive: true,
        lastUsedAt: new Date(),
      },
      update: {
        profileId: input.profileId,
        role: input.role,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent?.trim() || undefined,
        deviceLabel: input.deviceLabel?.trim() || undefined,
        isActive: true,
        lastUsedAt: new Date(),
      },
    });
  }

  async deactivateSubscription(endpoint: string) {
    return this.prisma.pushSubscription.updateMany({
      where: { endpoint },
      data: {
        isActive: false,
      },
    });
  }

  async getActiveManagerProfileIds() {
    const managers = await this.prisma.profile.findMany({
      where: {
        role: {
          in: [...MANAGER_ROLES],
        },
        chatAccessEnabled: true,
        isActive: true,
        approvalStatus: 'approved',
        status: {
          notIn: ['blocked', 'inactive'],
        },
        managerStatus: {
          in: ['online'],
        },
      },
      select: {
        id: true,
      },
    });

    return managers.map((manager) => manager.id);
  }

  async getActiveSupplierProfileIds(supplierId?: string | null) {
    const normalizedSupplierId = supplierId?.trim();
    const suppliers = await this.prisma.profile.findMany({
      where: {
        role: {
          in: [...SUPPLIER_ROLES],
        },
        chatAccessEnabled: true,
        isActive: true,
        approvalStatus: 'approved',
        status: {
          notIn: ['blocked', 'inactive'],
        },
        supplierStatus: {
          in: ['online'],
        },
        ...(normalizedSupplierId
          ? {
              OR: [{ id: normalizedSupplierId }, { supplierId: normalizedSupplierId }],
            }
          : {}),
      },
      select: {
        id: true,
      },
    });

    return suppliers.map((supplier) => supplier.id);
  }

  async getManagerTargetsForTicket(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        assignedManagerId: true,
        invitedManagerIds: true,
      },
    });

    if (!ticket) {
      return [];
    }

    const explicitTargets = [
      ticket.assignedManagerId,
      ...readJsonStringArray(ticket.invitedManagerIds),
    ].filter((value): value is string => Boolean(value));

    if (explicitTargets.length > 0) {
      return [...new Set(explicitTargets)];
    }

    return this.getActiveManagerProfileIds();
  }

  async sendToProfiles(
    profileIds: string[],
    payload: NotificationPayload,
    eventType: NotificationEventType,
    senderProfileId?: string,
  ) {
    if (!this.publicKey || !process.env.WEB_PUSH_PRIVATE_KEY?.trim()) {
      this.logger.warn(
        'WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY не заданы. Push-доставка пропущена.',
      );
      return;
    }

    const uniqueProfileIds = [...new Set(profileIds.filter(Boolean))];

    if (uniqueProfileIds.length === 0) {
      return;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: {
        profileId: {
          in: uniqueProfileIds,
        },
        isActive: true,
      },
      include: {
        profile: {
          select: {
            id: true,
            notificationPushEnabled: true,
            notifyClientChats: true,
            notifySupplierChats: true,
            notifySupplierRequests: true,
            notifyAiHandoffs: true,
            notifyAdminAlerts: true,
            chatAccessEnabled: true,
          },
        },
      },
    });

    await Promise.all(
      subscriptions.map(async (subscription) => {
        if (!subscription.profile) {
          return;
        }

        if (senderProfileId && subscription.profileId === senderProfileId) {
          return;
        }

        if (
          !subscription.profile.chatAccessEnabled ||
          !this.isEventEnabledForProfile(subscription.profile, eventType)
        ) {
          return;
        }

        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            JSON.stringify({
              title: payload.title,
              body: payload.body,
              icon: payload.icon ?? '/pwa/icon-192.svg',
              badge: payload.badge ?? '/pwa/badge.svg',
              data: {
                url: payload.url,
                tag: payload.tag ?? 'touchspace-notification',
              },
            }),
          );

          await this.prisma.pushSubscription.update({
            where: { endpoint: subscription.endpoint },
            data: {
              lastUsedAt: new Date(),
            },
          });
        } catch (error: any) {
          const statusCode = error?.statusCode;

          if (statusCode === 404 || statusCode === 410) {
            await this.deactivateSubscription(subscription.endpoint);
            return;
          }

          this.logger.warn(
            `Не удалось отправить push на endpoint ${subscription.endpoint}: ${error?.message ?? error}`,
          );
        }
      }),
    );
  }

  async sendTestNotification(profileId: string, role: string) {
    await this.sendToProfiles(
      [profileId],
      {
        title: 'TouchSpace готов',
        body: `Уведомления для роли ${role} настроены и работают.`,
        url:
          role === 'admin' ? '/admin' : role === 'supplier' ? '/supplier' : '/',
        tag: 'touchspace-test',
      },
      'admin_alerts',
    );

    return { ok: true };
  }
}
