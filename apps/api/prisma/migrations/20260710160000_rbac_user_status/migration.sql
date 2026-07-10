-- RBAC + User Management (P0 governance): add a user account status so DISABLED
-- users can be rejected at login. Authored via `prisma migrate diff` (non-TTY);
-- see platform/CLAUDE.md pgvector gotcha.

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- NOTE: Prisma's diff emits a false-drift `DROP INDEX "KnowledgeChunk_embedding_idx";`
-- here because it cannot model the pgvector HNSW index on the Unsupported vector
-- column. That line was removed by hand so the knowledge index survives.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';
