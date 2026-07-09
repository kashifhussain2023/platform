import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import type { WorkflowRunDto } from '@vaep/types';
import { WorkflowsService } from './workflows.service';

/**
 * PUBLIC webhook ingress for WEBHOOK-triggered workflows. Deliberately NOT
 * behind JwtAuthGuard — external systems POST here with only the secret token
 * in the path. The tenant is resolved from the workflow the token maps to; an
 * unknown/inactive/non-webhook token returns 404. The entire request body is
 * forwarded as the run's trigger payload.
 */
@Controller('workflows/webhooks')
export class WorkflowWebhooksController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Post(':token')
  @HttpCode(201)
  fire(
    @Param('token') token: string,
    @Body() payload: Record<string, unknown>,
  ): Promise<WorkflowRunDto> {
    return this.workflows.fireWebhook(token, payload);
  }
}
