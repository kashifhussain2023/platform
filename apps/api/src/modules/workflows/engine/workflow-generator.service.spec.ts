import type { LlmCompletionInput, LlmCompletionResult, LlmProvider } from '../../employees/llm/llm.provider';
import { WorkflowGeneratorService } from './workflow-generator.service';

/** A fake SkillsService exposing only the one method this service calls. */
function fakeSkills(installed: { skillKey: string }[]) {
  return { listInstalled: jest.fn().mockResolvedValue(installed) };
}

/** A fake PrismaService exposing only aiEmployee.findMany. */
function fakePrisma(employees: { id: string; name: string; role: string }[]) {
  return { aiEmployee: { findMany: jest.fn().mockResolvedValue(employees) } };
}

/** A scripted fake LlmProvider returning one canned response per call, in order. */
function scriptedLlm(responses: LlmCompletionResult[]): LlmProvider {
  let i = 0;
  return {
    name: 'scripted',
    complete: jest.fn(async (_input: LlmCompletionInput) => {
      const next = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return next;
    }),
  };
}

const VALID_DRAFT = {
  type: 'draft',
  definition: {
    nodes: [
      { id: 't', type: 'TRIGGER', config: {} },
      { id: 'a', type: 'TOOL_ACTION', config: { skillKey: 'slack', tool: 'send_message', args: {} } },
    ],
    edges: [{ from: 't', to: 'a' }],
  },
};

const INVALID_DRAFT = {
  type: 'draft',
  definition: {
    nodes: [
      { id: 't', type: 'TRIGGER', config: {} },
      { id: 'a', type: 'TOOL_ACTION', config: { skillKey: 'nope', tool: 'nope', args: {} } },
    ],
    edges: [{ from: 't', to: 'a' }],
  },
};

describe('WorkflowGeneratorService', () => {
  it('returns a valid draft unchanged when the first attempt is already valid', async () => {
    const llm = scriptedLlm([{ content: JSON.stringify(VALID_DRAFT) }]);
    const service = new WorkflowGeneratorService(
      fakePrisma([]) as never,
      fakeSkills([{ skillKey: 'slack' }]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'notify slack' }]);

    expect(result).toEqual({ type: 'draft', definition: VALID_DRAFT.definition, unresolvedNodes: [] });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('self-corrects: an invalid first attempt followed by a valid second attempt has zero unresolvedNodes', async () => {
    const llm = scriptedLlm([
      { content: JSON.stringify(INVALID_DRAFT) },
      { content: JSON.stringify(VALID_DRAFT) },
    ]);
    const service = new WorkflowGeneratorService(
      fakePrisma([]) as never,
      fakeSkills([{ skillKey: 'slack' }]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'notify slack' }]);

    expect(result.type).toBe('draft');
    expect((result as { unresolvedNodes: unknown[] }).unresolvedNodes).toEqual([]);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('degrades to a placeholder when still invalid after one self-correction, never throwing', async () => {
    const llm = scriptedLlm([
      { content: JSON.stringify(INVALID_DRAFT) },
      { content: JSON.stringify(INVALID_DRAFT) },
    ]);
    const service = new WorkflowGeneratorService(
      fakePrisma([]) as never,
      fakeSkills([{ skillKey: 'slack' }]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'notify slack' }]);

    expect(result.type).toBe('draft');
    if (result.type !== 'draft') throw new Error('expected draft');
    expect(result.unresolvedNodes).toEqual([
      { nodeId: 'a', reason: expect.stringContaining('nope') },
    ]);
    const toolNode = result.definition.nodes.find((n) => n.id === 'a')!;
    expect(toolNode.config.skillKey).toBe('');
    expect(toolNode.config.tool).toBe('');
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('passes a clarifying question straight through untouched', async () => {
    const llm = scriptedLlm([
      { content: JSON.stringify({ type: 'question', message: 'Which department?' }) },
    ]);
    const service = new WorkflowGeneratorService(
      fakePrisma([]) as never,
      fakeSkills([]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'automate hiring' }]);

    expect(result).toEqual({ type: 'question', message: 'Which department?' });
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('falls back to a question when the LLM never returns parseable JSON, after both attempts', async () => {
    const llm = scriptedLlm([{ content: 'not json at all' }, { content: 'still not json' }]);
    const service = new WorkflowGeneratorService(
      fakePrisma([]) as never,
      fakeSkills([{ skillKey: 'slack' }]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'notify slack' }]);

    expect(result).toEqual({
      type: 'question',
      message:
        "I couldn't build that — could you describe the workflow again, naming the specific steps you need?",
    });
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('falls back to a question when the definition is structurally invalid on both attempts (duplicate node id)', async () => {
    const structurallyInvalidDraft = {
      type: 'draft',
      definition: {
        nodes: [
          { id: 't', type: 'TRIGGER', config: {} },
          { id: 't', type: 'TOOL_ACTION', config: { skillKey: 'slack', tool: 'send_message', args: {} } },
        ],
        edges: [{ from: 't', to: 't' }],
      },
    };
    const llm = scriptedLlm([
      { content: JSON.stringify(structurallyInvalidDraft) },
      { content: JSON.stringify(structurallyInvalidDraft) },
    ]);
    const service = new WorkflowGeneratorService(
      fakePrisma([]) as never,
      fakeSkills([{ skillKey: 'slack' }]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'notify slack' }]);

    expect(result).toEqual({
      type: 'question',
      message: "I couldn't build a valid workflow from that — could you describe it again, one step at a time?",
    });
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it('silently clears an AI_STEP node\'s employeeId when it references an unknown employee, without flagging it as unresolved', async () => {
    const draftWithGhostEmployee = {
      type: 'draft',
      definition: {
        nodes: [
          { id: 't', type: 'TRIGGER', config: {} },
          { id: 'ai', type: 'AI_STEP', config: { employeeId: 'ghost_employee_id' } },
        ],
        edges: [{ from: 't', to: 'ai' }],
      },
    };
    const llm = scriptedLlm([{ content: JSON.stringify(draftWithGhostEmployee) }]);
    const service = new WorkflowGeneratorService(
      fakePrisma([{ id: 'emp_real', name: 'Real Employee', role: 'recruiter' }]) as never,
      fakeSkills([]) as never,
      llm,
    );

    const result = await service.generate('co_1', [{ role: 'user', content: 'have an employee draft a reply' }]);

    expect(result.type).toBe('draft');
    if (result.type !== 'draft') throw new Error('expected draft');
    expect(result.unresolvedNodes).toEqual([]);
    const aiNode = result.definition.nodes.find((n) => n.id === 'ai')!;
    expect(aiNode.config.employeeId).toBe('');
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });
});
