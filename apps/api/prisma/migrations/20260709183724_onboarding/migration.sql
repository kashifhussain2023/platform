-- CreateEnum
CREATE TYPE "KnowledgeAccess" AS ENUM ('ALL', 'NONE');

-- AlterTable
ALTER TABLE "AiEmployee" ADD COLUMN     "approvalRules" JSONB,
ADD COLUMN     "budgetLimit" INTEGER,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "knowledgeAccess" "KnowledgeAccess" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "language" TEXT,
ADD COLUMN     "managerName" TEXT,
ADD COLUMN     "permissions" JSONB,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "workingHoursEnd" TEXT,
ADD COLUMN     "workingHoursStart" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "country" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "size" TEXT,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT;
