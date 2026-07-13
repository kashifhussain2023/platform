import {
  EMPLOYEES_CLOSE,
  EMPLOYEES_OPEN,
  INSTALLED_SKILLS_CLOSE,
  INSTALLED_SKILLS_OPEN,
  WORKFLOW_GENERATOR_MARKER,
} from '../../workflows/workflows.constants';
import { MockLlmProvider } from './mock-llm.provider';

function systemPrompt(skills: unknown[], employees: unknown[]): string {
  return [
    WORKFLOW_GENERATOR_MARKER,
    'Reply with ONLY one JSON object...',
    `${INSTALLED_SKILLS_OPEN}${JSON.stringify(skills)}${INSTALLED_SKILLS_CLOSE}`,
    `${EMPLOYEES_OPEN}${JSON.stringify(employees)}${EMPLOYEES_CLOSE}`,
  ].join('\n');
}

describe('MockLlmProvider workflow-generation mode', () => {
  const provider = new MockLlmProvider();

  it('asks a clarifying question on the first turn when no skills are installed', async () => {
    const result = await provider.complete({
      system: systemPrompt([], []),
      messages: [{ role: 'user', content: 'automate my hiring' }],
    });
    const parsed = JSON.parse(result.content ?? '{}');
    expect(parsed.type).toBe('question');
    expect(typeof parsed.message).toBe('string');
  });

  it('drafts a grounded workflow referencing a real installed skill+employee', async () => {
    const result = await provider.complete({
      system: systemPrompt(
        [{ skillKey: 'slack', tools: ['send_message'] }],
        [{ id: 'emp_1', name: 'RecruitAI', role: 'RECRUITER' }],
      ),
      messages: [{ role: 'user', content: 'notify recruiting on Slack for new hires' }],
    });
    const parsed = JSON.parse(result.content ?? '{}');
    expect(parsed.type).toBe('draft');
    const toolAction = parsed.definition.nodes.find(
      (n: { type: string }) => n.type === 'TOOL_ACTION',
    );
    expect(toolAction.config.skillKey).toBe('slack');
    expect(toolAction.config.tool).toBe('send_message');
    const aiStep = parsed.definition.nodes.find((n: { type: string }) => n.type === 'AI_STEP');
    expect(aiStep.config.employeeId).toBe('emp_1');
  });

  it('drafts with a deliberately-invalid tool reference when no skills exist on a later turn', async () => {
    const result = await provider.complete({
      system: systemPrompt([], []),
      messages: [
        { role: 'user', content: 'automate my hiring' },
        { role: 'assistant', content: 'Which tool should this use?' },
        { role: 'user', content: 'just do something reasonable' },
      ],
    });
    const parsed = JSON.parse(result.content ?? '{}');
    expect(parsed.type).toBe('draft');
    const toolAction = parsed.definition.nodes.find(
      (n: { type: string }) => n.type === 'TOOL_ACTION',
    );
    expect(toolAction.config.skillKey).toBe('imaginary_skill');
  });
});
