-- CreateEnum
CREATE TYPE "SkillExecutionStatus" AS ENUM ('SUCCESS', 'ERROR');

-- NOTE: Prisma emits a false-drift `DROP INDEX "KnowledgeChunk_embedding_idx";`
-- here because it cannot model the pgvector HNSW index on the Unsupported
-- vector column. That line was removed by hand so the knowledge index survives
-- (see platform/CLAUDE.md pgvector gotcha).

-- CreateTable
CREATE TABLE "InstalledSkill" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "skillKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "config" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstalledSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeSkill" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "installedSkillId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillExecution" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT,
    "conversationId" TEXT,
    "skillKey" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "result" JSONB,
    "status" "SkillExecutionStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillExecution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstalledSkill_companyId_idx" ON "InstalledSkill"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "InstalledSkill_companyId_skillKey_key" ON "InstalledSkill"("companyId", "skillKey");

-- CreateIndex
CREATE INDEX "EmployeeSkill_companyId_idx" ON "EmployeeSkill"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSkill_employeeId_installedSkillId_key" ON "EmployeeSkill"("employeeId", "installedSkillId");

-- CreateIndex
CREATE INDEX "SkillExecution_companyId_idx" ON "SkillExecution"("companyId");

-- AddForeignKey
ALTER TABLE "InstalledSkill" ADD CONSTRAINT "InstalledSkill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "AiEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSkill" ADD CONSTRAINT "EmployeeSkill_installedSkillId_fkey" FOREIGN KEY ("installedSkillId") REFERENCES "InstalledSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
