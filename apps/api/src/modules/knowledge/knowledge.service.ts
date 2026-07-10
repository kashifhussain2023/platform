import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Queue } from 'bullmq';
import type { KnowledgeDocument } from '@prisma/client';
import type { KnowledgeDocumentDto, SearchResultDto } from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProvider,
} from './embeddings/embedding.provider';
import {
  STORAGE_PROVIDER_TOKEN,
  type StorageProvider,
} from './storage/storage.provider';
import {
  INGEST_JOB,
  KNOWLEDGE_INGEST_QUEUE,
  type IngestJobData,
} from './knowledge.constants';
import { SearchDto } from './dto/search.dto';
import { toVectorLiteral } from './knowledge.util';

/** Minimal shape of the Multer memory-storage file we consume on upload. */
export interface UploadedDocFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PROVIDER_TOKEN) private readonly storage: StorageProvider,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @InjectQueue(KNOWLEDGE_INGEST_QUEUE)
    private readonly queue: Queue<IngestJobData>,
  ) {}

  /** Store the bytes, create a PENDING doc, and enqueue async ingestion. */
  async upload(
    companyId: string,
    file: UploadedDocFile | undefined,
  ): Promise<KnowledgeDocumentDto> {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const storageKey = `${companyId}/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        companyId,
        filename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        status: 'PENDING',
      },
    });

    await this.queue.add(
      INGEST_JOB,
      { documentId: doc.id, companyId },
      { removeOnComplete: true, removeOnFail: 100 },
    );

    return toDocumentDto(doc);
  }

  async list(companyId: string): Promise<KnowledgeDocumentDto[]> {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map(toDocumentDto);
  }

  async get(companyId: string, id: string): Promise<KnowledgeDocumentDto> {
    const doc = await this.findOwned(companyId, id);
    return toDocumentDto(doc);
  }

  async remove(companyId: string, id: string): Promise<void> {
    const doc = await this.findOwned(companyId, id);
    // Best-effort blob delete; the row (and cascaded chunks) go regardless.
    await this.storage.delete(doc.storageKey).catch(() => undefined);
    await this.prisma.knowledgeDocument.delete({ where: { id: doc.id } });
  }

  /**
   * Cross-module retrieval capability consumed by the employees runtime
   * (RetrievalService). Reuses the exact embed + pgvector cosine search below so
   * the SQL is not duplicated. Tenant-scoped by companyId.
   */
  retrieve(
    companyId: string,
    query: string,
    k = 5,
  ): Promise<SearchResultDto[]> {
    return this.search(companyId, { query, k });
  }

  /** Embed the query and return the top-k nearest chunks for this tenant. */
  async search(companyId: string, dto: SearchDto): Promise<SearchResultDto[]> {
    const k = dto.k ?? 5;
    const [vector] = await this.embeddings.embed([dto.query]);
    const literal = toVectorLiteral(vector);

    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; documentId: string; content: string; score: number }>
    >`
      SELECT "id", "documentId", "content", 1 - (embedding <=> ${literal}::vector) AS score
      FROM "KnowledgeChunk"
      WHERE "companyId" = ${companyId} AND embedding IS NOT NULL
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${k}
    `;

    return rows.map((r) => ({
      chunkId: r.id,
      documentId: r.documentId,
      content: r.content,
      score: Number(r.score),
    }));
  }

  private async findOwned(
    companyId: string,
    id: string,
  ): Promise<KnowledgeDocument> {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, companyId },
    });
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    return doc;
  }
}

function toDocumentDto(doc: KnowledgeDocument): KnowledgeDocumentDto {
  return {
    id: doc.id,
    companyId: doc.companyId,
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    status: doc.status,
    error: doc.error,
    chunkCount: doc.chunkCount,
    createdAt: doc.createdAt.toISOString(),
  };
}
