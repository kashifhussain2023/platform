import { Injectable, NotFoundException } from '@nestjs/common';
import type { AiEmployee } from '@prisma/client';
import type {
  EmployeeFeedbackDto,
  EmployeeMemoryDto,
  LearningSummaryDto,
  MemoryKind,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { CreateMemoryDto } from './dto/create-memory.dto';
import { toFeedbackDto, toMemoryDto } from './employees.mapper';

/** How many recent feedback rows the learning summary surfaces. */
const RECENT_FEEDBACK_LIMIT = 10;

/**
 * Continuous Learning (Step 15). Managers rate AI outputs and can teach
 * corrections; a 👎 with a correction (or an explicit teach) is promoted to a
 * durable FACT EmployeeMemory (source 'FEEDBACK') that the runtime's
 * MemoryService already recalls by recency — closing the improvement loop. Also
 * curates durable memories (list / manually teach / forget). Every query is
 * tenant-scoped by companyId (from the JWT).
 */
@Injectable()
export class LearningService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Feedback ------------------------------------------------------------

  async submitFeedback(
    companyId: string,
    employeeId: string,
    dto: CreateFeedbackDto,
  ): Promise<EmployeeFeedbackDto> {
    await this.findOwnedEmployee(companyId, employeeId);

    const feedback = await this.prisma.employeeFeedback.create({
      data: {
        companyId,
        employeeId,
        conversationId: dto.conversationId ?? null,
        messageId: dto.messageId ?? null,
        rating: dto.rating,
        note: dto.note ?? null,
        correction: dto.correction ?? null,
      },
    });

    // Promote a correction (or an explicit teach) to a durable FACT memory so
    // the employee learns it — the runtime recalls EmployeeMemory rows already.
    const lesson = dto.correction?.trim() || dto.note?.trim();
    if (lesson && (dto.correction?.trim() || dto.teach === true)) {
      await this.prisma.employeeMemory.create({
        data: {
          companyId,
          employeeId,
          kind: 'FACT',
          content: lesson,
          source: 'FEEDBACK',
        },
      });
    }

    return toFeedbackDto(feedback);
  }

  async listFeedback(
    companyId: string,
    employeeId: string,
  ): Promise<EmployeeFeedbackDto[]> {
    await this.findOwnedEmployee(companyId, employeeId);
    const rows = await this.prisma.employeeFeedback.findMany({
      where: { companyId, employeeId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toFeedbackDto);
  }

  // --- Memory curation -----------------------------------------------------

  async listMemories(
    companyId: string,
    employeeId: string,
  ): Promise<EmployeeMemoryDto[]> {
    await this.findOwnedEmployee(companyId, employeeId);
    const rows = await this.prisma.employeeMemory.findMany({
      where: { companyId, employeeId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toMemoryDto);
  }

  /** Manually teach a durable memory (source 'MANUAL'). */
  async teachMemory(
    companyId: string,
    employeeId: string,
    dto: CreateMemoryDto,
  ): Promise<EmployeeMemoryDto> {
    await this.findOwnedEmployee(companyId, employeeId);
    const memory = await this.prisma.employeeMemory.create({
      data: {
        companyId,
        employeeId,
        kind: dto.kind,
        content: dto.content,
        source: 'MANUAL',
      },
    });
    return toMemoryDto(memory);
  }

  /** Forget a durable memory (tenant + employee checked). */
  async forgetMemory(
    companyId: string,
    employeeId: string,
    memoryId: string,
  ): Promise<void> {
    await this.findOwnedEmployee(companyId, employeeId);
    const memory = await this.prisma.employeeMemory.findFirst({
      where: { id: memoryId, companyId, employeeId },
    });
    if (!memory) {
      throw new NotFoundException('Memory not found');
    }
    await this.prisma.employeeMemory.delete({ where: { id: memoryId } });
  }

  // --- Learning summary ----------------------------------------------------

  async summary(
    companyId: string,
    employeeId: string,
  ): Promise<LearningSummaryDto> {
    await this.findOwnedEmployee(companyId, employeeId);

    const [feedbackByRating, memoriesByKind, recent] = await Promise.all([
      this.prisma.employeeFeedback.groupBy({
        by: ['rating'],
        where: { companyId, employeeId },
        _count: { _all: true },
      }),
      this.prisma.employeeMemory.groupBy({
        by: ['kind'],
        where: { companyId, employeeId },
        _count: { _all: true },
      }),
      this.prisma.employeeFeedback.findMany({
        where: { companyId, employeeId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_FEEDBACK_LIMIT,
      }),
    ]);

    const up =
      feedbackByRating.find((r) => r.rating === 'UP')?._count._all ?? 0;
    const down =
      feedbackByRating.find((r) => r.rating === 'DOWN')?._count._all ?? 0;

    const byKind: Record<MemoryKind, number> = { FACT: 0, SUMMARY: 0 };
    for (const row of memoriesByKind) {
      byKind[row.kind] = row._count._all;
    }

    return {
      feedback: { up, down, total: up + down },
      memories: { total: byKind.FACT + byKind.SUMMARY, byKind },
      recentFeedback: recent.map(toFeedbackDto),
    };
  }

  // --- Ownership helper ----------------------------------------------------

  private async findOwnedEmployee(
    companyId: string,
    id: string,
  ): Promise<AiEmployee> {
    const employee = await this.prisma.aiEmployee.findFirst({
      where: { id, companyId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }
}
