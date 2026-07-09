-- CreateEnum
CREATE TYPE "FeedbackRating" AS ENUM ('UP', 'DOWN');

-- NOTE: Prisma emits a false-drift `DROP INDEX "KnowledgeChunk_embedding_idx";`
-- here because it cannot model the pgvector HNSW index on the Unsupported
-- vector column. That line was removed by hand so the knowledge index survives
-- (see platform/CLAUDE.md pgvector gotcha).

-- AlterTable
ALTER TABLE "EmployeeMemory" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "EmployeeFeedback" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "rating" "FeedbackRating" NOT NULL,
    "note" TEXT,
    "correction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeFeedback_companyId_idx" ON "EmployeeFeedback"("companyId");

-- CreateIndex
CREATE INDEX "EmployeeFeedback_employeeId_idx" ON "EmployeeFeedback"("employeeId");

-- AddForeignKey
ALTER TABLE "EmployeeFeedback" ADD CONSTRAINT "EmployeeFeedback_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "AiEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
