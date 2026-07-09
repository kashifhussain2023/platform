-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('MANUAL', 'SCHEDULE', 'WEBHOOK', 'EVENT');

-- NOTE: Prisma emits a false-drift `DROP INDEX "KnowledgeChunk_embedding_idx";`
-- here because it cannot model the pgvector HNSW index on the Unsupported
-- vector column. That line was removed by hand so the knowledge index survives
-- (see platform/CLAUDE.md pgvector gotcha).

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "triggerConfig" JSONB,
ADD COLUMN     "triggerType" "TriggerType" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "webhookToken" TEXT;

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_webhookToken_key" ON "Workflow"("webhookToken");
