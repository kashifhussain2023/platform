import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { asFetchResponse } from '../../../common/http/fetch-response';
import { SkillsService } from '../skills.service';
import {
  providerForSkill,
  resolveOAuthProvider,
  type ResolvedOAuthProvider,
} from './oauth.providers';

/** Decoded, verified OAuth state payload (stateless — HMAC-signed, not stored). */
interface OAuthState {
  installedSkillId: string;
  companyId: string;
  skillKey: string;
  nonce: string;
  /** Issued-at (epoch ms) — the state is rejected after STATE_TTL_MS. */
  iat: number;
}

/** Signed OAuth state lifetime (defends against stale/replayed authorize links). */
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Real OAuth authorization-code flow for `oauth` catalog skills. Stateless: the
 * `state` parameter is an HMAC-signed (CryptoService) envelope carrying the
 * installedSkillId + companyId, so the public callback can trust it with no
 * server-side storage. Tokens obtained from the provider are stored ENCRYPTED on
 * the installed skill (via SkillsService.connectOAuth) and it is marked
 * CONNECTED.
 */
@Injectable()
export class OAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly crypto: CryptoService,
    private readonly skills: SkillsService,
  ) {}

  /**
   * Build the provider authorize URL for an installed oauth skill. Throws 400
   * when the skill is not an oauth skill or its provider is not configured.
   */
  async buildAuthorizeUrl(
    companyId: string,
    installedSkillId: string,
  ): Promise<string> {
    const installed = await this.skills.getOwnedInstalled(
      companyId,
      installedSkillId,
    );
    const provider = this.resolveOrThrow(installed.skillKey);

    const state = this.signState({
      installedSkillId,
      companyId,
      skillKey: installed.skillKey,
      nonce: randomBytes(12).toString('hex'),
      iat: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: provider.clientId,
      redirect_uri: provider.redirectUri,
      response_type: 'code',
      scope: provider.scopes.join(' '),
      state,
      ...provider.extraAuthParams,
    });
    return `${provider.authorizeUrl}?${params.toString()}`;
  }

  /**
   * Handle the provider redirect: verify+parse the state, exchange the code for
   * tokens, store them encrypted + mark CONNECTED, and return the web URL to
   * redirect the browser to. Any failure returns a `?error=` web URL rather than
   * throwing so the user lands back on the skills page.
   */
  async handleCallback(
    code: string | undefined,
    stateRaw: string | undefined,
  ): Promise<string> {
    const webBase = this.webOrigin();
    let state: OAuthState;
    try {
      state = this.parseState(stateRaw);
    } catch (err) {
      return `${webBase}/skills?error=${encodeURIComponent(
        err instanceof Error ? err.message : 'invalid_state',
      )}`;
    }

    try {
      if (!code) {
        throw new Error('Missing authorization code');
      }
      const provider = this.resolveOrThrow(state.skillKey);
      const tokens = await this.exchangeCode(provider, code);
      await this.skills.connectOAuth(
        state.companyId,
        state.installedSkillId,
        tokens,
      );
      return `${webBase}/skills?connected=${encodeURIComponent(state.skillKey)}`;
    } catch (err) {
      return `${webBase}/skills?error=${encodeURIComponent(
        err instanceof Error ? err.message : 'oauth_failed',
      )}`;
    }
  }

  // --- Token exchange -------------------------------------------------------

  private async exchangeCode(
    provider: ResolvedOAuthProvider,
    code: string,
  ): Promise<Record<string, unknown>> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      redirect_uri: provider.redirectUri,
    });
    const res = asFetchResponse(
      await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: body.toString(),
      }),
    );
    const data = (await res.json()) as Record<string, unknown>;
    // Slack returns HTTP 200 with { ok:false, error } on failure.
    if (!res.ok || data.ok === false) {
      const msg =
        (typeof data.error === 'string' && data.error) ||
        (typeof data.error_description === 'string' && data.error_description) ||
        `token exchange failed (${res.status})`;
      throw new Error(msg);
    }
    const accessToken =
      (typeof data.access_token === 'string' && data.access_token) || '';
    if (!accessToken) {
      throw new Error('Provider did not return an access_token');
    }
    const expiresIn =
      typeof data.expires_in === 'number' ? data.expires_in : undefined;
    return {
      accessToken,
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
      tokenType: typeof data.token_type === 'string' ? data.token_type : undefined,
      scope: typeof data.scope === 'string' ? data.scope : undefined,
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : undefined,
    };
  }

  // --- Signed state (stateless HMAC) ----------------------------------------

  /** `state = base64url(json).<hmacHex>` — verifiable with no server storage. */
  private signState(payload: OAuthState): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.crypto.sign(body)}`;
  }

  private parseState(stateRaw: string | undefined): OAuthState {
    if (!stateRaw || typeof stateRaw !== 'string' || !stateRaw.includes('.')) {
      throw new Error('invalid_state');
    }
    const idx = stateRaw.lastIndexOf('.');
    const body = stateRaw.slice(0, idx);
    const sig = stateRaw.slice(idx + 1);
    if (!this.crypto.verify(body, sig)) {
      throw new Error('invalid_state');
    }
    let payload: OAuthState;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as OAuthState;
    } catch {
      throw new Error('invalid_state');
    }
    if (
      !payload.installedSkillId ||
      !payload.companyId ||
      !payload.skillKey ||
      typeof payload.iat !== 'number'
    ) {
      throw new Error('invalid_state');
    }
    if (Date.now() - payload.iat > STATE_TTL_MS) {
      throw new Error('state_expired');
    }
    return payload;
  }

  // --- Helpers --------------------------------------------------------------

  private resolveOrThrow(skillKey: string): ResolvedOAuthProvider {
    const provider = resolveOAuthProvider(skillKey, this.config);
    if (!provider) {
      const name = providerForSkill(skillKey) ?? skillKey;
      throw new BadRequestException(`OAuth not configured for ${name}`);
    }
    return provider;
  }

  private webOrigin(): string {
    return (
      this.config.get<string>('WEB_ORIGIN')?.replace(/\/$/, '') ??
      'http://localhost:3000'
    );
  }
}
