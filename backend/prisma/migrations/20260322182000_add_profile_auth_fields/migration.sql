ALTER TABLE "Profile"
ADD COLUMN "authLogin" TEXT,
ADD COLUMN "passwordHash" TEXT,
ADD COLUMN "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "passwordIssuedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Profile_authLogin_key" ON "Profile"("authLogin");
