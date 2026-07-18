-- DropIndex
DROP INDEX "InstalledSkill_companyId_skillKey_key";

-- AlterTable
ALTER TABLE "InstalledSkill" ADD COLUMN     "employeeId" TEXT;

-- CreateIndex
CREATE INDEX "InstalledSkill_employeeId_idx" ON "InstalledSkill"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "InstalledSkill_companyId_skillKey_employeeId_key" ON "InstalledSkill"("companyId", "skillKey", "employeeId");

-- AddForeignKey
ALTER TABLE "InstalledSkill" ADD CONSTRAINT "InstalledSkill_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "AiEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
