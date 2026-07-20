-- CreateEnum
CREATE TYPE "SupportConversationStatus" AS ENUM ('OPEN', 'RESOLVED', 'PENDING');

-- CreateEnum
CREATE TYPE "SupportMessageDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "ChatwootAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chatwootAccountId" TEXT NOT NULL,
    "agentBotId" TEXT NOT NULL,
    "agentBotToken" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatwootAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportConversation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chatwootAccountId" TEXT NOT NULL,
    "chatwootConversationId" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" "SupportConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "chatwootMessageId" TEXT,
    "direction" "SupportMessageDirection" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatwootAccount_companyId_key" ON "ChatwootAccount"("companyId");

-- CreateIndex
CREATE INDEX "ChatwootAccount_companyId_idx" ON "ChatwootAccount"("companyId");

-- CreateIndex
CREATE INDEX "SupportConversation_companyId_idx" ON "SupportConversation"("companyId");

-- CreateIndex
CREATE INDEX "SupportConversation_companyId_chatwootConversationId_idx" ON "SupportConversation"("companyId", "chatwootConversationId");

-- CreateIndex
CREATE INDEX "SupportMessage_companyId_idx" ON "SupportMessage"("companyId");

-- CreateIndex
CREATE INDEX "SupportMessage_conversationId_idx" ON "SupportMessage"("conversationId");

-- AddForeignKey
ALTER TABLE "ChatwootAccount" ADD CONSTRAINT "ChatwootAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_chatwootAccountId_fkey" FOREIGN KEY ("chatwootAccountId") REFERENCES "ChatwootAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

