import { Injectable } from '@nestjs/common';
import type { EmployeeMemory, Message } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  RECENT_MEMORY_LIMIT,
  RECENT_MESSAGE_LIMIT,
} from '../employees.constants';

/** Working memory assembled for a run: recent turns + recalled memories. */
export interface LoadedMemory {
  /** Recent conversation messages, oldest → newest. */
  messages: Message[];
  /** Recalled employee memories, most-recent first. */
  memories: EmployeeMemory[];
}

/**
 * Loads short-term (recent conversation Messages) and long-term (EmployeeMemory)
 * context for a run — recalled by recency, no vectors here — and can append a
 * SUMMARY memory afterwards.
 */
@Injectable()
export class MemoryService {
  constructor(private readonly prisma: PrismaService) {}

  async load(
    companyId: string,
    conversationId: string,
    employeeId: string,
  ): Promise<LoadedMemory> {
    const [recent, memories] = await Promise.all([
      this.prisma.message.findMany({
        where: { companyId, conversationId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_MESSAGE_LIMIT,
      }),
      // No `kind` filter: BOTH SUMMARY (run) and FACT memories are recalled, so
      // feedback-derived / manually-taught FACTs (Step 15 continuous learning)
      // are injected into the agent context — closing the improvement loop.
      this.prisma.employeeMemory.findMany({
        where: { companyId, employeeId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_MEMORY_LIMIT,
      }),
    ]);
    // Reverse messages back to chronological order for prompt building.
    return { messages: recent.reverse(), memories };
  }

  /** Persist a rolling SUMMARY memory after a run (recalled later by recency). */
  async appendSummary(
    companyId: string,
    employeeId: string,
    content: string,
  ): Promise<void> {
    await this.prisma.employeeMemory.create({
      data: { companyId, employeeId, kind: 'SUMMARY', content },
    });
  }
}
