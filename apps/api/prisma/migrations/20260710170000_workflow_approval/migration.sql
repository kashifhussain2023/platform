-- Workflow-level APPROVAL node (P1 #5): a run can pause at an APPROVAL step
-- (status WAITING), which opens a WORKFLOW-kind ApprovalRequest in the Approval
-- Center; approving resumes the run, rejecting fails it. Authored via
-- `prisma migrate diff` (non-TTY); see platform/CLAUDE.md pgvector gotcha.
--
-- NOTE: Prisma's diff emits a false-drift `DROP INDEX "KnowledgeChunk_embedding_idx";`
-- here because it cannot model the pgvector HNSW index on the Unsupported vector
-- column. That line was removed by hand so the knowledge index survives.

-- CreateEnum
CREATE TYPE "ApprovalKind" AS ENUM ('TOOL', 'WORKFLOW');

-- AlterEnum
ALTER TYPE "WorkflowRunStatus" ADD VALUE 'WAITING';

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "kind" "ApprovalKind" NOT NULL DEFAULT 'TOOL',
ADD COLUMN     "workflowRunId" TEXT,
ALTER COLUMN "skillKey" DROP NOT NULL,
ALTER COLUMN "tool" DROP NOT NULL;

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "resumeNodeId" TEXT;
