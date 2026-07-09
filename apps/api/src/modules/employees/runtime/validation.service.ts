import { Injectable } from '@nestjs/common';
import type {
  EmployeeRole,
  MessageValidationDto,
  SearchResultDto,
} from '@vaep/types';
import {
  APPROVAL_CONFIDENCE_THRESHOLD,
  HIGH_STAKES_ROLES,
} from '../employees.constants';

/** Significant word tokens (length >= 4), lowercased. */
function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Post-draft validation (no external calls). Decides whether the answer is
 * grounded in the retrieved sources (by significant-token overlap), assigns a
 * confidence in [0,1] from grounding + the top similarity score, and flags
 * `needsApproval` when confidence is low or the role is high-stakes (e.g.
 * ACCOUNTANT/HR). Citations themselves travel separately on the RunResult.
 */
@Injectable()
export class ValidationService {
  validate(
    role: EmployeeRole,
    answer: string,
    sources: SearchResultDto[],
  ): MessageValidationDto {
    const answerTokens = tokenize(answer);
    const sourceTokens = new Set<string>();
    for (const s of sources) {
      for (const t of tokenize(s.content)) {
        sourceTokens.add(t);
      }
    }

    let shared = 0;
    for (const t of sourceTokens) {
      if (answerTokens.has(t)) {
        shared += 1;
      }
    }
    const overlapRatio = sourceTokens.size > 0 ? shared / sourceTokens.size : 0;
    const grounded = sources.length > 0 && shared >= 3;

    const topScore = sources[0]?.score ?? 0;
    const confidence = round2(
      grounded
        ? clamp(0.45 + 0.5 * topScore + 0.1 * overlapRatio, 0, 0.98)
        : sources.length > 0
          ? 0.35
          : 0.2,
    );

    const highStakes = HIGH_STAKES_ROLES.includes(role);
    const needsApproval =
      highStakes || confidence < APPROVAL_CONFIDENCE_THRESHOLD;

    const notes: string[] = [];
    notes.push(
      grounded
        ? `Grounded in ${sources.length} retrieved source(s).`
        : 'Answer is not clearly grounded in retrieved knowledge.',
    );
    if (highStakes) {
      notes.push(`High-stakes role (${role}) — human approval required.`);
    } else if (confidence < APPROVAL_CONFIDENCE_THRESHOLD) {
      notes.push('Low confidence — human review recommended.');
    }

    return { grounded, confidence, needsApproval, notes: notes.join(' ') };
  }
}
