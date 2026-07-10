-- Connector Event Ingestion (Unit A): the per-provider event pipeline —
-- RawEvent (append-only ingestion log) + CanonicalEvent (provider-agnostic
-- envelope) + the RawEventStatus enum. Authored via `prisma migrate diff`
-- (non-TTY); see platform/CLAUDE.md pgvector gotcha.
--
-- NOTE: Prisma's diff emitted a false-drift `DROP INDEX "KnowledgeChunk_embedding_idx";`
-- here because it cannot model the pgvector HNSW index on the Unsupported vector
-- column. That line was removed by hand so the knowledge index survives.

-- CreateEnum
CREATE TYPE "RawEventStatus" AS ENUM ('RECEIVED', 'NORMALIZED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "RawEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "signatureVerified" BOOLEAN NOT NULL,
    "headers" JSONB,
    "payload" JSONB NOT NULL,
    "status" "RawEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "rawEventId" TEXT,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subject" JSONB,
    "data" JSONB,
    "schemaVersion" TEXT NOT NULL DEFAULT '1.0',

    CONSTRAINT "CanonicalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawEvent_companyId_idx" ON "RawEvent"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RawEvent_connectorId_externalId_key" ON "RawEvent"("connectorId", "externalId");

-- CreateIndex
CREATE INDEX "CanonicalEvent_companyId_type_idx" ON "CanonicalEvent"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalEvent_companyId_dedupeKey_key" ON "CanonicalEvent"("companyId", "dedupeKey");

