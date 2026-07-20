-- AlterEnum
ALTER TYPE "ScheduledPostStatus" ADD VALUE 'PUBLISHED';

-- Note: `prisma migrate diff` also proposed `DROP INDEX "KnowledgeChunk_embedding_idx"`.
-- That's pre-existing, intentional drift: KnowledgeChunk.embedding is an
-- `Unsupported("vector(384)")` column, so its HNSW index is created via raw SQL in
-- migration 20260709150515_knowledge (Prisma can't model indexes on Unsupported
-- columns) and will never appear in a schema-derived diff. It is deliberately
-- omitted here — dropping it would break Knowledge Base vector search.
