import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PLANE_ENV } from './pm.constants';

export interface PlaneIssueDto {
  id: string;
  name: string;
  state: string;
  assignees?: string[];
}

/**
 * Thin, typed wrapper around a self-hosted Plane instance's public API
 * (`api/v1/...`). Auth is per-workspace: the caller passes an already-decrypted
 * `apiToken` (stored per-company in `PlaneWorkspace.apiToken`), never a single
 * shared deployment-wide secret like Postiz's — only `PLANE_BASE_URL` comes
 * from ConfigService here.
 */
@Injectable()
export class PlaneClientService {
  private readonly logger = new Logger(PlaneClientService.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    const url = this.config.get<string>(PLANE_ENV.BASE_URL);
    if (!url) throw new Error(`${PLANE_ENV.BASE_URL} is not configured`);
    return url.replace(/\/$/, '');
  }

  async createIssue(
    workspaceSlug: string,
    projectId: string,
    apiToken: string,
    input: { title: string; description?: string },
  ): Promise<{ planeIssueId: string }> {
    const res = await fetch(
      `${this.baseUrl()}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/`,
      {
        method: 'POST',
        headers: { 'X-Api-Key': apiToken, 'content-type': 'application/json' },
        body: JSON.stringify({ name: input.title, description_html: input.description ?? '' }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Plane createIssue failed (${res.status}): ${text}`);
      throw new Error(`Plane createIssue failed: ${res.status}`);
    }
    const data = (await res.json()) as { id: string };
    return { planeIssueId: data.id };
  }

  async listIssues(
    workspaceSlug: string,
    projectId: string,
    apiToken: string,
  ): Promise<PlaneIssueDto[]> {
    const res = await fetch(
      `${this.baseUrl()}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/`,
      { headers: { 'X-Api-Key': apiToken } },
    );
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Plane listIssues failed (${res.status}): ${text}`);
      throw new Error(`Plane listIssues failed: ${res.status}`);
    }
    return (await res.json()) as PlaneIssueDto[];
  }

  async updateIssueStatus(
    workspaceSlug: string,
    projectId: string,
    apiToken: string,
    issueId: string,
    status: string,
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl()}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/`,
      {
        method: 'PATCH',
        headers: { 'X-Api-Key': apiToken, 'content-type': 'application/json' },
        body: JSON.stringify({ state: status }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Plane updateIssueStatus failed (${res.status}): ${text}`);
      throw new Error(`Plane updateIssueStatus failed: ${res.status}`);
    }
  }

  /**
   * Plane's webhook scheme (verified directly against Plane's real source,
   * `plane/bgtasks/webhook_task.py`, not guessed) is a RAW hex HMAC-SHA256
   * digest of the exact JSON payload bytes — no "sha256=" prefix, no
   * timestamp component (unlike Chatwoot's scheme in the sibling Support
   * engine). Verification MUST hash the literal raw request body bytes,
   * never a re-serialized version.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string, webhookSecret: string): boolean {
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    let a: Buffer;
    let b: Buffer;
    try {
      a = Buffer.from(expected, 'hex');
      b = Buffer.from(signatureHeader, 'hex');
    } catch {
      return false;
    }
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  async provisionWorkspace(): Promise<never> {
    // NOT LIVE-VERIFIED -- no self-hosted Plane instance exists in this dev
    // environment to run this against. Grounded directly in Plane's real
    // Django source (not guessed):
    //   apps/api/plane/app/views/workspace/base.py: WorkSpaceViewSet.create
    //   apps/api/plane/app/views/api.py: ApiTokenEndpoint
    // Both live under the session-cookie `app/` namespace, NOT the API-key
    // `api/v1` namespace -- confirmed by reading the actual view classes'
    // permission_classes. This means provisioning a new workspace + API
    // token requires an authenticated Plane user session (login via
    // apps/api/plane/authentication/, obtain a session cookie, THEN call
    // the workspace-create + api-token-create endpoints as that session),
    // not a pure API-key call the way Postiz's public API allows. Do not
    // fabricate a "working" implementation that has never been run against
    // a live instance -- verify this sequence against real docs/a live
    // instance before implementing for real.
    throw new Error('NOT YET IMPLEMENTED — requires a live Plane instance to verify the session-based provisioning sequence');
  }
}
