import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  getDefaultFullNameForRole,
  isManagerRole,
  isSupplierRole,
  MANAGER_ROLES,
  SUPPLIER_ROLES,
} from './role.utils';

type EnsureProfileInput = {
  id?: string | null;
  fullName?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  authLogin?: string | null;
  passwordHash?: string | null;
  passwordChangeRequired?: boolean | null;
  passwordIssuedAt?: Date | null;
  status?: string | null;
  approvalStatus?: string | null;
  companyName?: string | null;
  companyId?: string | null;
  supplierId?: string | null;
  supervisorProfileId?: string | null;
  managerStatus?: string | null;
  managerPresenceHeartbeatAt?: Date | null;
  supplierStatus?: string | null;
  supplierPresenceHeartbeatAt?: Date | null;
  approvalComment?: string | null;
  lastLoginAt?: Date | null;
  createdByAdminId?: string | null;
  isActive?: boolean | null;
  notificationPushEnabled?: boolean | null;
  notifyClientChats?: boolean | null;
  notifySupplierChats?: boolean | null;
  notifySupplierRequests?: boolean | null;
  notifyAiHandoffs?: boolean | null;
  notifyAdminAlerts?: boolean | null;
  chatAccessEnabled?: boolean | null;
};

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveCompatibleRole(id: string, fallbackRole: string) {
    const existingProfile = await this.prisma.profile.findUnique({
      where: { id },
      select: { role: true },
    });

    if (isManagerRole(fallbackRole) && isManagerRole(existingProfile?.role)) {
      return existingProfile?.role ?? fallbackRole;
    }

    if (isSupplierRole(fallbackRole) && isSupplierRole(existingProfile?.role)) {
      return existingProfile?.role ?? fallbackRole;
    }

    return existingProfile?.role?.trim() || fallbackRole;
  }

  private resolvePresenceStatus(
    presenceStatus: string | null,
    _heartbeatAt: Date | null,
  ) {
    if (!presenceStatus || presenceStatus === 'offline') {
      return 'offline';
    }

    return presenceStatus;
  }

  async updateBasicProfile(id: string, fullName: string) {
    const normalizedId = id?.trim();
    const normalizedFullName = fullName?.trim();

    if (!normalizedId) {
      throw new BadRequestException('userId обязателен');
    }

    if (!normalizedFullName) {
      throw new BadRequestException('Имя обязательно');
    }

    const existingProfile = await this.prisma.profile.findUnique({
      where: { id: normalizedId },
      select: {
        id: true,
        email: true,
        role: true,
        fullName: true,
      },
    });

    if (!existingProfile) {
      throw new NotFoundException(`Profile with id "${normalizedId}" not found`);
    }

    return this.prisma.profile.update({
      where: { id: normalizedId },
      data: {
        fullName: normalizedFullName,
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
      },
    });
  }

  async getManagerStatuses() {
    const managers = await this.prisma.profile.findMany({
      where: {
        role: {
          in: [...MANAGER_ROLES],
        },
        isActive: true,
        approvalStatus: {
          not: 'rejected',
        },
      },
      orderBy: {
        fullName: 'asc',
      },
      select: {
        id: true,
        fullName: true,
        managerStatus: true,
        managerPresenceHeartbeatAt: true,
        lastLoginAt: true,
      },
    });

    return managers.map((manager) => ({
      id: manager.id,
      fullName: manager.fullName,
      managerStatus: this.resolvePresenceStatus(
        manager.managerStatus,
        manager.managerPresenceHeartbeatAt,
      ),
      lastLoginAt: manager.lastLoginAt,
      managerPresenceHeartbeatAt: manager.managerPresenceHeartbeatAt,
    }));
  }

  async hasOnlineManagers() {
    const onlineManagers = await this.prisma.profile.count({
      where: {
        role: {
          in: [...MANAGER_ROLES],
        },
        isActive: true,
        approvalStatus: {
          not: 'rejected',
        },
        managerStatus: 'online',
      },
    });

    return onlineManagers > 0;
  }

  async updateManagerStatus(
    id: string,
    managerStatus: string,
    fullName?: string | null,
  ) {
    const normalizedId = id?.trim();
    const normalizedStatus = managerStatus?.trim();

    if (!normalizedId || !normalizedStatus) {
      return null;
    }

    const resolvedRole = await this.resolveCompatibleRole(
      normalizedId,
      'manager',
    );

    await this.ensureProfile({
      id: normalizedId,
      role: resolvedRole,
      fullName,
      managerStatus: normalizedStatus,
      managerPresenceHeartbeatAt:
        normalizedStatus === 'offline' ? null : new Date(),
    });

    return this.prisma.profile.update({
      where: {
        id: normalizedId,
      },
      data: {
        managerStatus: normalizedStatus,
        managerPresenceHeartbeatAt:
          normalizedStatus === 'offline' ? null : new Date(),
      },
      select: {
        id: true,
        fullName: true,
        managerStatus: true,
        managerPresenceHeartbeatAt: true,
      },
    });
  }

  async getSupplierStatuses() {
    const suppliers = await this.prisma.profile.findMany({
      where: {
        role: {
          in: [...SUPPLIER_ROLES],
        },
        isActive: true,
        approvalStatus: {
          not: 'rejected',
        },
      },
      orderBy: {
        fullName: 'asc',
      },
      select: {
        id: true,
        fullName: true,
        companyName: true,
        supplierId: true,
        supplierStatus: true,
        supplierPresenceHeartbeatAt: true,
        lastLoginAt: true,
      },
    });

    return suppliers.map((supplier) => ({
      id: supplier.id,
      fullName: supplier.fullName,
      companyName: supplier.companyName,
      supplierId: supplier.supplierId,
      supplierStatus: this.resolvePresenceStatus(
        supplier.supplierStatus,
        supplier.supplierPresenceHeartbeatAt,
      ),
      lastLoginAt: supplier.lastLoginAt,
      supplierPresenceHeartbeatAt: supplier.supplierPresenceHeartbeatAt,
    }));
  }

  async hasOnlineSuppliersForScope(supplierId: string) {
    const normalizedSupplierId = supplierId?.trim();

    if (!normalizedSupplierId) {
      return false;
    }

    const onlineSuppliers = await this.prisma.profile.count({
      where: {
        role: {
          in: [...SUPPLIER_ROLES],
        },
        isActive: true,
        approvalStatus: {
          not: 'rejected',
        },
        supplierId: normalizedSupplierId,
        supplierStatus: 'online',
      },
    });

    return onlineSuppliers > 0;
  }

  async updateSupplierStatus(
    id: string,
    supplierStatus: string,
    fullName?: string | null,
  ) {
    const normalizedId = id?.trim();
    const normalizedStatus = supplierStatus?.trim();

    if (!normalizedId || !normalizedStatus) {
      return null;
    }

    const existingProfile = await this.prisma.profile.findUnique({
      where: { id: normalizedId },
      select: {
        role: true,
        supplierId: true,
      },
    });
    const resolvedRole =
      isSupplierRole(existingProfile?.role) && existingProfile?.role
        ? existingProfile.role
        : 'supplier';

    await this.ensureProfile({
      id: normalizedId,
      role: resolvedRole,
      fullName,
      supplierId: existingProfile?.supplierId?.trim() || undefined,
      supplierStatus: normalizedStatus,
      supplierPresenceHeartbeatAt:
        normalizedStatus === 'offline' ? null : new Date(),
    });

    return this.prisma.profile.update({
      where: {
        id: normalizedId,
      },
      data: {
        supplierStatus: normalizedStatus,
        supplierPresenceHeartbeatAt:
          normalizedStatus === 'offline' ? null : new Date(),
      },
      select: {
        id: true,
        fullName: true,
        supplierStatus: true,
        supplierPresenceHeartbeatAt: true,
      },
    });
  }

  async ensureProfile(input: EnsureProfileInput) {
    const id = input.id?.trim();
    const role = input.role?.trim();

    if (!id || !role) {
      return null;
    }

    const fullNameForCreate =
      input.fullName?.trim() ||
      (role === 'client' ? 'Клиент' : getDefaultFullNameForRole(role));
    const fullNameForUpdate = input.fullName?.trim() || undefined;

    return this.prisma.profile.upsert({
      where: { id },
      create: {
        id,
        fullName: fullNameForCreate,
        role,
        email: input.email?.trim() || null,
        phone: input.phone?.trim() || null,
        authLogin: input.authLogin?.trim() || null,
        passwordHash: input.passwordHash ?? null,
        passwordChangeRequired: input.passwordChangeRequired ?? false,
        passwordIssuedAt: input.passwordIssuedAt ?? null,
        status: input.status?.trim() || 'active',
        approvalStatus: input.approvalStatus?.trim() || 'approved',
        companyName: input.companyName?.trim() || null,
        companyId: input.companyId?.trim() || null,
        supplierId: input.supplierId?.trim() || null,
        supervisorProfileId: input.supervisorProfileId?.trim() || null,
        managerStatus: input.managerStatus?.trim() || null,
        managerPresenceHeartbeatAt: input.managerPresenceHeartbeatAt ?? null,
        supplierStatus: input.supplierStatus?.trim() || null,
        supplierPresenceHeartbeatAt: input.supplierPresenceHeartbeatAt ?? null,
        approvalComment: input.approvalComment?.trim() || null,
        lastLoginAt: input.lastLoginAt ?? null,
        createdByAdminId: input.createdByAdminId?.trim() || null,
        isActive: input.isActive ?? true,
        notificationPushEnabled: input.notificationPushEnabled ?? true,
        notifyClientChats: input.notifyClientChats ?? true,
        notifySupplierChats: input.notifySupplierChats ?? true,
        notifySupplierRequests: input.notifySupplierRequests ?? true,
        notifyAiHandoffs: input.notifyAiHandoffs ?? true,
        notifyAdminAlerts: input.notifyAdminAlerts ?? true,
        chatAccessEnabled: input.chatAccessEnabled ?? true,
      },
      update: {
        fullName: fullNameForUpdate,
        role,
        email: input.email?.trim() || undefined,
        phone: input.phone?.trim() || undefined,
        authLogin: input.authLogin?.trim() || undefined,
        passwordHash: input.passwordHash ?? undefined,
        passwordChangeRequired: input.passwordChangeRequired ?? undefined,
        passwordIssuedAt: input.passwordIssuedAt ?? undefined,
        status: input.status?.trim() || undefined,
        approvalStatus: input.approvalStatus?.trim() || undefined,
        companyName: input.companyName?.trim() || undefined,
        companyId: input.companyId?.trim() || undefined,
        supplierId: input.supplierId?.trim() || undefined,
        supervisorProfileId: input.supervisorProfileId?.trim() || undefined,
        managerStatus: input.managerStatus?.trim() || undefined,
        managerPresenceHeartbeatAt:
          input.managerPresenceHeartbeatAt ?? undefined,
        supplierStatus: input.supplierStatus?.trim() || undefined,
        supplierPresenceHeartbeatAt:
          input.supplierPresenceHeartbeatAt ?? undefined,
        approvalComment: input.approvalComment?.trim() || undefined,
        lastLoginAt: input.lastLoginAt ?? undefined,
        createdByAdminId: input.createdByAdminId?.trim() || undefined,
        isActive: input.isActive ?? undefined,
        notificationPushEnabled: input.notificationPushEnabled ?? undefined,
        notifyClientChats: input.notifyClientChats ?? undefined,
        notifySupplierChats: input.notifySupplierChats ?? undefined,
        notifySupplierRequests: input.notifySupplierRequests ?? undefined,
        notifyAiHandoffs: input.notifyAiHandoffs ?? undefined,
        notifyAdminAlerts: input.notifyAdminAlerts ?? undefined,
        chatAccessEnabled: input.chatAccessEnabled ?? undefined,
      },
    });
  }
}
