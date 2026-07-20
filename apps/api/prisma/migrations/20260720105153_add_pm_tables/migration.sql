-- CreateTable
CREATE TABLE "PlaneWorkspace" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planeWorkspaceSlug" TEXT NOT NULL,
    "apiToken" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaneWorkspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaneProject" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planeWorkspaceId" TEXT NOT NULL,
    "planeProjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaneProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedIssue" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "planeProjectId" TEXT NOT NULL,
    "planeIssueId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assignee" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaneWorkspace_companyId_key" ON "PlaneWorkspace"("companyId");

-- CreateIndex
CREATE INDEX "PlaneWorkspace_companyId_idx" ON "PlaneWorkspace"("companyId");

-- CreateIndex
CREATE INDEX "PlaneProject_companyId_idx" ON "PlaneProject"("companyId");

-- CreateIndex
CREATE INDEX "TrackedIssue_companyId_idx" ON "TrackedIssue"("companyId");

-- CreateIndex
CREATE INDEX "TrackedIssue_companyId_planeIssueId_idx" ON "TrackedIssue"("companyId", "planeIssueId");

-- AddForeignKey
ALTER TABLE "PlaneWorkspace" ADD CONSTRAINT "PlaneWorkspace_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaneProject" ADD CONSTRAINT "PlaneProject_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaneProject" ADD CONSTRAINT "PlaneProject_planeWorkspaceId_fkey" FOREIGN KEY ("planeWorkspaceId") REFERENCES "PlaneWorkspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedIssue" ADD CONSTRAINT "TrackedIssue_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedIssue" ADD CONSTRAINT "TrackedIssue_planeProjectId_fkey" FOREIGN KEY ("planeProjectId") REFERENCES "PlaneProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

