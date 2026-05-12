import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'crypto';
import { PrismaService } from './prisma.service';
import { isManagerRole, isSupplierRole } from './role.utils';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}
  private readonly temporaryPasswordAlphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derivedKey}`;
  }

  private verifyPassword(
    password: string,
    storedHash: string | null | undefined,
  ) {
    if (!storedHash) {
      return false;
    }

    const [salt, key] = storedHash.split(':');

    if (!salt || !key) {
      return false;
    }

    const derivedKey = scryptSync(password, salt, 64);
    const storedKey = Buffer.from(key, 'hex');

    if (derivedKey.length !== storedKey.length) {
      return false;
    }

    return timingSafeEqual(derivedKey, storedKey);
  }

  private sanitizeLoginCandidate(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9@._-]+/g, '.')
      .replace(/\.+/g, '.')
      .replace(/^\.|\.$/g, '');
  }

  private async buildUniqueLogin(baseValue: string) {
    const sanitizedBase =
      this.sanitizeLoginCandidate(baseValue) || `user.${Date.now()}`;
    let candidate = sanitizedBase;
    let counter = 1;

    while (
      await this.prisma.profile.findFirst({ where: { authLogin: candidate } })
    ) {
      candidate = `${sanitizedBase}.${counter}`;
      counter += 1;
    }

    return candidate;
  }

  private generateTemporaryPassword() {
    return Array.from({ length: 14 }, () =>
      this.temporaryPasswordAlphabet[randomInt(0, this.temporaryPasswordAlphabet.length)],
    ).join('');
  }

  private assertPasswordStrength(password: string) {
    if (password.trim().length < 8) {
      throw new BadRequestException(
        'Пароль должен быть не короче 8 символов',
      );
    }
  }

  async issueCredentialsForProfile(
    profileId: string,
    preferredLogin?: string | null,
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      throw new BadRequestException(`Profile with id "${profileId}" not found`);
    }

    const loginBase =
      preferredLogin?.trim() ||
      profile.email?.trim() ||
      `${profile.role}.${profile.fullName}` ||
      `user.${profile.id}`;

    const login =
      profile.authLogin?.trim() || (await this.buildUniqueLogin(loginBase));
    const temporaryPassword = this.generateTemporaryPassword();

    await this.prisma.profile.update({
      where: { id: profileId },
      data: {
        authLogin: login,
        passwordHash: this.hashPassword(temporaryPassword),
        passwordChangeRequired: true,
        passwordIssuedAt: new Date(),
        activeSessionToken: null,
        activeSessionIssuedAt: null,
      },
    });

    return {
      login,
      temporaryPassword,
      passwordChangeRequired: true,
    };
  }

  async setCredentialsForProfile(
    profileId: string,
    password: string,
    preferredLogin?: string | null,
    options?: {
      passwordChangeRequired?: boolean;
    },
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      throw new BadRequestException(`Profile with id "${profileId}" not found`);
    }

    this.assertPasswordStrength(password);

    const loginBase =
      preferredLogin?.trim() ||
      profile.email?.trim() ||
      `${profile.role}.${profile.fullName}` ||
      `user.${profile.id}`;

    const login =
      profile.authLogin?.trim() || (await this.buildUniqueLogin(loginBase));

    const passwordChangeRequired = options?.passwordChangeRequired ?? true;

    await this.prisma.profile.update({
      where: { id: profileId },
      data: {
        authLogin: login,
        passwordHash: this.hashPassword(password),
        passwordChangeRequired,
        passwordIssuedAt: new Date(),
        activeSessionToken: null,
        activeSessionIssuedAt: null,
      },
    });

    return {
      login,
      temporaryPassword: password,
      passwordChangeRequired,
    };
  }

  async login(login: string, password: string) {
    const normalizedLogin = this.sanitizeLoginCandidate(login);
    const profile = await this.prisma.profile.findFirst({
      where: {
        OR: [{ authLogin: normalizedLogin }, { email: normalizedLogin }],
      },
    });

    const passwordMatchesProfile = profile
      ? this.verifyPassword(password, profile.passwordHash)
      : false;

    if (!passwordMatchesProfile) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    if (!profile) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const authorizedProfile = profile;

    if (
      authorizedProfile.status === 'blocked' ||
      authorizedProfile.status === 'inactive' ||
      authorizedProfile.approvalStatus === 'rejected' ||
      authorizedProfile.approvalStatus === 'pending' ||
      !authorizedProfile.isActive
    ) {
      throw new ForbiddenException(
        'Доступ пользователя не активирован или заблокирован администратором',
      );
    }

    const sessionToken = randomUUID();

    await this.prisma.profile.update({
      where: { id: authorizedProfile.id },
      data: {
        lastLoginAt: new Date(),
        activeSessionToken: sessionToken,
        activeSessionIssuedAt: new Date(),
        managerStatus: isManagerRole(authorizedProfile.role)
          ? 'online'
          : undefined,
        managerPresenceHeartbeatAt:
          isManagerRole(authorizedProfile.role) ? new Date() : undefined,
        supplierStatus: isSupplierRole(authorizedProfile.role)
          ? 'online'
          : undefined,
        supplierPresenceHeartbeatAt:
          isSupplierRole(authorizedProfile.role) ? new Date() : undefined,
      },
    });

    return {
      user: {
        id: authorizedProfile.id,
        login: authorizedProfile.authLogin ?? normalizedLogin,
        role: authorizedProfile.role,
        fullName: authorizedProfile.fullName,
        email: authorizedProfile.email,
        companyName: authorizedProfile.companyName,
        supplierId: authorizedProfile.supplierId,
        chatAccessEnabled: authorizedProfile.chatAccessEnabled,
        passwordChangeRequired: authorizedProfile.passwordChangeRequired,
        sessionToken,
      },
    };
  }

  async validateSession(userId: string, sessionToken: string) {
    const normalizedUserId = userId?.trim();
    const normalizedSessionToken = sessionToken?.trim();

    if (!normalizedUserId || !normalizedSessionToken) {
      throw new BadRequestException('userId и sessionToken обязательны');
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: normalizedUserId },
      select: {
        id: true,
        activeSessionToken: true,
      },
    });

    if (!profile || !profile.activeSessionToken) {
      return {
        valid: false,
        reason: 'session_missing',
      };
    }

    if (profile.activeSessionToken !== normalizedSessionToken) {
      return {
        valid: false,
        reason: 'other_device_login',
      };
    }

    return {
      valid: true,
    };
  }

  async logout(userId: string, sessionToken?: string) {
    const normalizedUserId = userId?.trim();
    const normalizedSessionToken = sessionToken?.trim();

    if (!normalizedUserId) {
      throw new BadRequestException('userId обязателен');
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: normalizedUserId },
      select: {
        id: true,
        activeSessionToken: true,
      },
    });

    if (!profile) {
      return {
        ok: true,
      };
    }

    if (
      normalizedSessionToken &&
      profile.activeSessionToken &&
      profile.activeSessionToken !== normalizedSessionToken
    ) {
      return {
        ok: true,
      };
    }

    await this.prisma.profile.update({
      where: { id: normalizedUserId },
      data: {
        activeSessionToken: null,
        activeSessionIssuedAt: null,
      },
    });

    return {
      ok: true,
    };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      throw new BadRequestException(`Profile with id "${userId}" not found`);
    }

    if (!this.verifyPassword(currentPassword, profile.passwordHash)) {
      throw new UnauthorizedException('Текущий пароль введён неверно');
    }

    this.assertPasswordStrength(newPassword);

    await this.prisma.profile.update({
      where: { id: userId },
      data: {
        passwordHash: this.hashPassword(newPassword),
        passwordChangeRequired: false,
        passwordIssuedAt: new Date(),
      },
    });

    return {
      ok: true,
    };
  }
}
