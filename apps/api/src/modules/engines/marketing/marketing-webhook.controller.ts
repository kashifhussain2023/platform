import { Body, Controller, Post } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Controller('engines/marketing/webhook')
export class MarketingWebhookController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async receive(@Body() body: { postId?: string; status?: string }): Promise<{ ok: boolean }> {
    // Postiz's own webhook payload is unsigned (postiz-engine.md §13) — treat
    // this as a hint to sync sooner, never as the sole source of truth; the
    // MarketingSyncProcessor sweep (Task 5, Step 3) is what actually confirms.
    if (body.postId) {
      await this.prisma.scheduledPost.updateMany({
        where: { postizPostId: body.postId },
        data: { status: body.status === 'PUBLISHED' ? 'SCHEDULED' : 'FAILED' },
      });
    }
    return { ok: true };
  }
}
