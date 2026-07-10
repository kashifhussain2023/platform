-- AlterTable: per-connector inbound polling watermark (Gmail historyId).
ALTER TABLE "InstalledSkill" ADD COLUMN     "inboundCursor" TEXT;
