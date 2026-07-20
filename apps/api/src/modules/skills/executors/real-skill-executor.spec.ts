import type { ConfigService } from '@nestjs/config';
import { RealSkillExecutor } from './real-skill-executor';
import type { SkillExecutor } from './skill-executor';
import type { SchedulingService } from '../../scheduling/scheduling.service';

// Minimal stand-ins for the collaborators RealSkillExecutor doesn't exercise in
// these postiz.* cases (no network config lookups, no scheduling, no fallback).
const configMock = {} as unknown as ConfigService;
const fallbackMock = {
  execute: jest.fn().mockResolvedValue({ ok: false, error: 'not implemented' }),
} as unknown as SkillExecutor;
const schedulingMock = {} as unknown as SchedulingService;

const ctx = { companyId: 'c_1' };

describe('RealSkillExecutor — postiz.*', () => {
  describe('postiz.schedule_post', () => {
    it('delegates to PostizClientService.schedulePost', async () => {
      const postizClient = {
        schedulePost: jest.fn().mockResolvedValue({ postizPostId: 'p_123' }),
      };
      const prisma = {
        socialAccount: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'sa_1',
            companyId: 'c_1',
            postizIntegrationId: 'int_1',
          }),
        },
        scheduledPost: {
          create: jest.fn().mockResolvedValue({ id: 'sp_1' }),
        },
      };
      const executor = new RealSkillExecutor(
        configMock,
        fallbackMock,
        schedulingMock,
        postizClient as any,
        prisma as any,
      );
      const result = await executor.execute(
        'postiz',
        'schedule_post',
        { socialAccountId: 'sa_1', content: 'Hello world', publishAt: '2026-08-01T09:00:00Z' },
        ctx,
      );
      expect(result.ok).toBe(true);
      expect(postizClient.schedulePost).toHaveBeenCalledWith(
        expect.objectContaining({
          postizIntegrationId: 'int_1',
          content: 'Hello world',
          type: 'schedule',
          date: '2026-08-01T09:00:00Z',
        }),
      );
      expect(result.result).toEqual({ scheduledPostId: 'sp_1', postizPostId: 'p_123' });
    });

    it('fails without hitting Postiz when the SocialAccount is missing', async () => {
      const postizClient = { schedulePost: jest.fn() };
      const prisma = {
        socialAccount: { findFirst: jest.fn().mockResolvedValue(null) },
        scheduledPost: { create: jest.fn() },
      };
      const executor = new RealSkillExecutor(
        configMock,
        fallbackMock,
        schedulingMock,
        postizClient as any,
        prisma as any,
      );
      const result = await executor.execute(
        'postiz',
        'schedule_post',
        { socialAccountId: 'sa_missing', content: 'Hi', publishAt: '2026-08-01T09:00:00Z' },
        ctx,
      );
      expect(result.ok).toBe(false);
      expect(postizClient.schedulePost).not.toHaveBeenCalled();
    });
  });

  describe('postiz.publish_now', () => {
    it('delegates to PostizClientService.schedulePost with type "now"', async () => {
      const postizClient = {
        schedulePost: jest.fn().mockResolvedValue({ postizPostId: 'p_456' }),
      };
      const prisma = {
        socialAccount: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'sa_1',
            companyId: 'c_1',
            postizIntegrationId: 'int_1',
          }),
        },
      };
      const executor = new RealSkillExecutor(
        configMock,
        fallbackMock,
        schedulingMock,
        postizClient as any,
        prisma as any,
      );
      const result = await executor.execute(
        'postiz',
        'publish_now',
        { socialAccountId: 'sa_1', content: 'Go live' },
        ctx,
      );
      expect(result.ok).toBe(true);
      expect(postizClient.schedulePost).toHaveBeenCalledWith(
        expect.objectContaining({ postizIntegrationId: 'int_1', content: 'Go live', type: 'now' }),
      );
      expect(result.result).toEqual({ postizPostId: 'p_456' });
    });
  });

  describe('postiz.list_connected_accounts', () => {
    it('returns the company\'s CONNECTED social accounts', async () => {
      const postizClient = {};
      const accounts = [{ id: 'sa_1', status: 'CONNECTED' }];
      const prisma = {
        socialAccount: { findMany: jest.fn().mockResolvedValue(accounts) },
      };
      const executor = new RealSkillExecutor(
        configMock,
        fallbackMock,
        schedulingMock,
        postizClient as any,
        prisma as any,
      );
      const result = await executor.execute('postiz', 'list_connected_accounts', {}, ctx);
      expect(result.ok).toBe(true);
      expect(prisma.socialAccount.findMany).toHaveBeenCalledWith({
        where: { companyId: 'c_1', status: 'CONNECTED' },
      });
      expect(result.result).toEqual({ accounts });
    });
  });

  describe('postiz.start_connect_account', () => {
    it('delegates to PostizClientService.getConnectUrl', async () => {
      const postizClient = {
        getConnectUrl: jest.fn().mockResolvedValue({ url: 'https://postiz.example/connect' }),
      };
      const executor = new RealSkillExecutor(
        configMock,
        fallbackMock,
        schedulingMock,
        postizClient as any,
        {} as any,
      );
      const result = await executor.execute(
        'postiz',
        'start_connect_account',
        { platform: 'instagram' },
        ctx,
      );
      expect(result.ok).toBe(true);
      expect(postizClient.getConnectUrl).toHaveBeenCalledWith('instagram');
      expect(result.result).toEqual({ url: 'https://postiz.example/connect' });
    });

    it('fails when platform is missing', async () => {
      const postizClient = { getConnectUrl: jest.fn() };
      const executor = new RealSkillExecutor(
        configMock,
        fallbackMock,
        schedulingMock,
        postizClient as any,
        {} as any,
      );
      const result = await executor.execute('postiz', 'start_connect_account', {}, ctx);
      expect(result.ok).toBe(false);
      expect(postizClient.getConnectUrl).not.toHaveBeenCalled();
    });
  });

  describe('postiz.get_post_status', () => {
    it('returns the stored ScheduledPost status when no PublishedPost exists yet', async () => {
      const postizClient = {};
      const prisma = {
        scheduledPost: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'sp_1',
            status: 'SCHEDULED',
            postizPostId: 'p_123',
          }),
        },
        publishedPost: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const executor = new RealSkillExecutor(
        configMock,
        fallbackMock,
        schedulingMock,
        postizClient as any,
        prisma as any,
      );
      const result = await executor.execute(
        'postiz',
        'get_post_status',
        { scheduledPostId: 'sp_1' },
        ctx,
      );
      expect(result.ok).toBe(true);
      expect(result.result).toEqual({ status: 'SCHEDULED', postizPostId: 'p_123' });
    });

    it('includes platformPostId/permalink when a PublishedPost row exists', async () => {
      const postizClient = {};
      const prisma = {
        scheduledPost: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'sp_1',
            status: 'PUBLISHED',
            postizPostId: 'p_123',
          }),
        },
        publishedPost: {
          findUnique: jest.fn().mockResolvedValue({
            platformPostId: 'ig_123',
            permalink: 'https://instagram.com/p/abc',
          }),
        },
      };
      const executor = new RealSkillExecutor(
        configMock,
        fallbackMock,
        schedulingMock,
        postizClient as any,
        prisma as any,
      );
      const result = await executor.execute(
        'postiz',
        'get_post_status',
        { scheduledPostId: 'sp_1' },
        ctx,
      );
      expect(result.ok).toBe(true);
      expect(result.result).toEqual({
        status: 'PUBLISHED',
        postizPostId: 'p_123',
        platformPostId: 'ig_123',
        permalink: 'https://instagram.com/p/abc',
      });
    });

    it('fails when the ScheduledPost is not found for this company', async () => {
      const postizClient = {};
      const prisma = {
        scheduledPost: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const executor = new RealSkillExecutor(
        configMock,
        fallbackMock,
        schedulingMock,
        postizClient as any,
        prisma as any,
      );
      const result = await executor.execute(
        'postiz',
        'get_post_status',
        { scheduledPostId: 'sp_missing' },
        ctx,
      );
      expect(result.ok).toBe(false);
    });
  });
});
