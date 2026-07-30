-- AlterTable Memory: long-term memory fields
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE "Memory" ADD COLUMN IF NOT EXISTS "chatId" TEXT;
ALTER TABLE "Memory" ALTER COLUMN "importance" SET DEFAULT 5;
UPDATE "Memory" SET "importance" = 5 WHERE "importance" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Memory_userId_importance_idx" ON "Memory"("userId", "importance");

-- CreateTable Connector
CREATE TABLE IF NOT EXISTS "Connector" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "syncInterval" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable ConnectorSyncJob
CREATE TABLE IF NOT EXISTS "ConnectorSyncJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "documentsCreated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "connectorId" TEXT NOT NULL,

    CONSTRAINT "ConnectorSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Connector_userId_idx" ON "Connector"("userId");
CREATE INDEX IF NOT EXISTS "Connector_status_lastSyncedAt_idx" ON "Connector"("status", "lastSyncedAt");
CREATE INDEX IF NOT EXISTS "ConnectorSyncJob_connectorId_idx" ON "ConnectorSyncJob"("connectorId");
CREATE INDEX IF NOT EXISTS "ConnectorSyncJob_status_idx" ON "ConnectorSyncJob"("status");

DO $$ BEGIN
  ALTER TABLE "Connector" ADD CONSTRAINT "Connector_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ConnectorSyncJob" ADD CONSTRAINT "ConnectorSyncJob_connectorId_fkey"
    FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
