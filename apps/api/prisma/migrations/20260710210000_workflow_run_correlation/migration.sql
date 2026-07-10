-- Correlation & lineage (Unit D, docs §9): add WorkflowRun.triggerEventId (the
-- CanonicalEvent id that fired an EVENT run — the lineage join key) and
-- WorkflowRun.correlationId (ties event→run→steps in logs/tracing). Both nullable
-- so existing rows are unaffected. Authored via `prisma migrate diff` (non-TTY).
--
-- NOTE: the diff emitted a false-drift `DROP INDEX "KnowledgeChunk_embedding_idx";`
-- (Prisma cannot model the pgvector HNSW index on the Unsupported vector column).
-- That line was removed by hand so the knowledge index survives — see
-- platform/CLAUDE.md pgvector gotcha.

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "triggerEventId" TEXT;

-- CreateIndex
CREATE INDEX "WorkflowRun_companyId_triggerEventId_idx" ON "WorkflowRun"("companyId", "triggerEventId");
