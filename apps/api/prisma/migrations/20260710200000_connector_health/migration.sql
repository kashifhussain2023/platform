-- Connector health / DEGRADED lifecycle (Unit B): docs/architecture/connector-
-- event-workflow-architecture.md §1.6 (token/refresh) · §1.7 (state machine) ·
-- §1.8 (health checks). Extends the SkillConnectionStatus enum with DEGRADED +
-- DISCONNECTED and adds the connector-health columns to InstalledSkill (the row
-- that plays the Connector role). Authored via `prisma migrate diff` (non-TTY).
--
-- NOTE: Prisma's diff emitted a false-drift `DROP INDEX "KnowledgeChunk_embedding_idx";`
-- here because it cannot model the pgvector HNSW index on the Unsupported vector
-- column. That line was removed by hand so the knowledge index survives (see
-- platform/CLAUDE.md pgvector gotcha).

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "SkillConnectionStatus" ADD VALUE 'DEGRADED';
ALTER TYPE "SkillConnectionStatus" ADD VALUE 'DISCONNECTED';

-- AlterTable
ALTER TABLE "InstalledSkill" ADD COLUMN     "consecutiveErrors" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disabledReason" TEXT,
ADD COLUMN     "lastHealthCheckAt" TIMESTAMP(3),
ADD COLUMN     "lastHealthError" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);
