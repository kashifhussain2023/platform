import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { POSTIZ_ENV } from './marketing.constants';

export interface SchedulePostInput {
  postizIntegrationId: string;
  content: string;
  type: 'draft' | 'schedule' | 'now';
  date?: string; // ISO datetime, required when type === 'schedule'
  mediaUrls?: string[];
}

export interface PostizIntegrationDto {
  id: string;
  name: string;
  identifier: string;
  picture?: string;
  disabled: boolean;
  customer?: { id: string; name: string };
}

export interface PostizPostDto {
  id: string;
  state: string;
  releaseId?: string;
  releaseURL?: string;
}

/**
 * Minimal shape of the global `fetch()` Response we actually use. Typed
 * locally (rather than trusting the ambient global `Response`) because
 * `@types/node`'s fetch typings live behind a `typesVersions` redirect keyed
 * on the resolved TypeScript version, which can differ between build
 * environments and has been observed to drop these members.
 */
interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/**
 * Thin, typed wrapper around the self-hosted Postiz public API
 * (docs/architecture/engines/postiz-engine.md §11, postiz-integration-plan.md).
 * One shared API key for the whole Orlixa deployment — never per-company.
 */
@Injectable()
export class PostizClientService {
  private readonly logger = new Logger(PostizClientService.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    const url = this.config.get<string>(POSTIZ_ENV.BASE_URL);
    if (!url) throw new Error(`${POSTIZ_ENV.BASE_URL} is not configured`);
    return url.replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    const key = this.config.get<string>(POSTIZ_ENV.API_KEY);
    if (!key) throw new Error(`${POSTIZ_ENV.API_KEY} is not configured`);
    return { Authorization: key, 'content-type': 'application/json' };
  }

  async getConnectUrl(platform: string, refreshIntegrationId?: string): Promise<{ url: string }> {
    const qs = refreshIntegrationId ? `?refresh=${encodeURIComponent(refreshIntegrationId)}` : '';
    const res = (await fetch(`${this.baseUrl()}/public/v1/social/${platform}${qs}`, {
      headers: this.headers(),
    })) as unknown as FetchResponseLike;
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Postiz getConnectUrl(${platform}) failed (${res.status}): ${text}`);
      throw new Error(`Postiz getConnectUrl(${platform}) failed: ${res.status}`);
    }
    return (await res.json()) as { url: string };
  }

  async listIntegrations(group?: string): Promise<PostizIntegrationDto[]> {
    const qs = group ? `?group=${encodeURIComponent(group)}` : '';
    const res = (await fetch(`${this.baseUrl()}/public/v1/integrations${qs}`, {
      headers: this.headers(),
    })) as unknown as FetchResponseLike;
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Postiz listIntegrations failed (${res.status}): ${text}`);
      throw new Error(`Postiz listIntegrations failed: ${res.status}`);
    }
    return (await res.json()) as PostizIntegrationDto[];
  }

  async schedulePost(input: SchedulePostInput): Promise<{ postizPostId: string }> {
    const body = {
      type: input.type,
      date: input.date,
      posts: [
        {
          integration: { id: input.postizIntegrationId },
          value: [{ content: input.content }],
        },
      ],
    };
    const res = (await fetch(`${this.baseUrl()}/public/v1/posts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    })) as unknown as FetchResponseLike;
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Postiz schedulePost failed (${res.status}): ${text}`);
      throw new Error(`Postiz schedulePost failed: ${res.status}`);
    }
    const data = (await res.json()) as { id?: string; postId?: string };
    const postizPostId = data.id ?? data.postId;
    if (!postizPostId) {
      throw new Error('Postiz schedulePost returned no post id');
    }
    return { postizPostId };
  }

  async listPosts(): Promise<PostizPostDto[]> {
    const res = (await fetch(`${this.baseUrl()}/public/v1/posts`, {
      headers: this.headers(),
    })) as unknown as FetchResponseLike;
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Postiz listPosts failed (${res.status}): ${text}`);
      throw new Error(`Postiz listPosts failed: ${res.status}`);
    }
    return (await res.json()) as PostizPostDto[];
  }
}
