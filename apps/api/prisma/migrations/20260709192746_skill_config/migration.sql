-- CreateEnum
CREATE TYPE "SkillConnectionStatus" AS ENUM ('NOT_CONNECTED', 'CONNECTED');

-- NOTE: Prisma emits a false-drift `DROP INDEX "KnowledgeChunk_embedding_idx";`
-- here because it cannot model the pgvector HNSW index on the Unsupported
-- vector column. That line was removed by hand so the knowledge index survives
-- (see platform/CLAUDE.md pgvector gotcha).

-- AlterTable
ALTER TABLE "InstalledSkill" ADD COLUMN     "connectionStatus" "SkillConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
ADD COLUMN     "connectionType" TEXT,
ADD COLUMN     "credentials" JSONB;
