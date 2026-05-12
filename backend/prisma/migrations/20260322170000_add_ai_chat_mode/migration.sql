ALTER TABLE "Ticket"
ADD COLUMN "conversationMode" TEXT NOT NULL DEFAULT 'manager',
ADD COLUMN "currentHandlerType" TEXT NOT NULL DEFAULT 'manager',
ADD COLUMN "aiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "aiActivatedAt" TIMESTAMP(3),
ADD COLUMN "aiDeactivatedAt" TIMESTAMP(3),
ADD COLUMN "handedToManagerAt" TIMESTAMP(3),
ADD COLUMN "aiResolved" BOOLEAN NOT NULL DEFAULT false;
