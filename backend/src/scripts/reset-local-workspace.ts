import { randomBytes } from 'crypto';
import { AuthService } from '../auth.service';
import { PrismaService } from '../prisma.service';

const RESET_CONFIRMATION = 'touchspace-local-reset';

function getDatabaseHost() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not defined');
  }

  return new URL(connectionString).hostname;
}

function buildTemporaryPassword() {
  return `TS-${randomBytes(6).toString('base64url')}`;
}

async function main() {
  if (process.env.RESET_LOCAL_DATA_CONFIRM !== RESET_CONFIRMATION) {
    throw new Error(
      `For safety set RESET_LOCAL_DATA_CONFIRM=${RESET_CONFIRMATION} before running the reset script.`,
    );
  }

  const databaseHost = getDatabaseHost();
  const allowedHosts = new Set(['127.0.0.1', 'localhost', 'mysql']);

  if (!allowedHosts.has(databaseHost)) {
    throw new Error(
      `Refusing to run against non-local database host "${databaseHost}".`,
    );
  }

  const adminLogin = (process.env.RESET_ADMIN_LOGIN?.trim() || 'admin').toLowerCase();
  const adminEmail = process.env.RESET_ADMIN_EMAIL?.trim().toLowerCase() || null;
  const adminName = process.env.RESET_ADMIN_NAME?.trim() || 'Администратор TouchSpace';
  const adminPassword = process.env.RESET_ADMIN_PASSWORD?.trim() || buildTemporaryPassword();

  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const existingAdmin =
      (await prisma.profile.findFirst({
        where: {
          OR: [
            { authLogin: adminLogin },
            ...(adminEmail ? [{ email: adminEmail }] : []),
          ],
        },
        orderBy: [{ createdAt: 'asc' }],
      })) ??
      (await prisma.profile.findFirst({
        where: {
          role: 'admin',
        },
        orderBy: [{ createdAt: 'asc' }],
      }));

    const adminProfile =
      existingAdmin ??
      (await prisma.profile.create({
        data: {
          id: `admin_${Date.now()}`,
          fullName: adminName,
          email: adminEmail,
          authLogin: adminLogin,
          role: 'admin',
          status: 'active',
          approvalStatus: 'approved',
          isActive: true,
          chatAccessEnabled: true,
        },
      }));

    await prisma.$transaction(async (tx) => {
      await tx.adminEvent.deleteMany({});
      await tx.pushSubscription.deleteMany({});
      await tx.managerMessageSuggestion.deleteMany({});
      await tx.registrationRequest.deleteMany({});
      await tx.message.deleteMany({});
      await tx.supplierRequest.deleteMany({});
      await tx.ticketPageView.deleteMany({});
      await tx.ticketContact.deleteMany({});
      await tx.ticket.deleteMany({});
      await tx.clientVisualIdentity.deleteMany({});

      await tx.profile.update({
        where: { id: adminProfile.id },
        data: {
          fullName: adminName,
          email: adminEmail,
          authLogin: adminLogin,
          role: 'admin',
          status: 'active',
          approvalStatus: 'approved',
          isActive: true,
          companyName: null,
          supplierId: null,
          supervisorProfileId: null,
          managerStatus: null,
          managerPresenceHeartbeatAt: null,
          supplierStatus: null,
          supplierPresenceHeartbeatAt: null,
          approvalComment: null,
          activeSessionToken: null,
          activeSessionIssuedAt: null,
          lastLoginAt: null,
        },
      });

      await tx.profile.deleteMany({
        where: {
          id: {
            not: adminProfile.id,
          },
        },
      });
    });

    const authService = new AuthService(prisma);
    const credentials = await authService.setCredentialsForProfile(
      adminProfile.id,
      adminPassword,
      adminLogin,
      {
        passwordChangeRequired: false,
      },
    );

    console.log('Local workspace reset completed.');
    console.log(`Admin login: ${credentials.login}`);
    console.log(`Admin password: ${credentials.temporaryPassword}`);
    console.log('All chats, requests, registrations, push subscriptions and non-admin users were removed.');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
