/**
 * Illustrative flat rate (USD per 1M tokens), roughly mid-tier LLM pricing —
 * NOT each provider's real invoiced price, which varies by model and
 * changes over time. Directionally useful for "what is this company
 * roughly costing us / what are they spending," not an exact bill. Matches
 * this project's existing convention of clearly-labeled illustrative figures
 * (see the billing plan prices and analytics ROI copy).
 */
const PROMPT_RATE_PER_1M_USD = 3;
const COMPLETION_RATE_PER_1M_USD = 15;

export function estimateCostUsd(
  promptTokens: number,
  completionTokens: number,
): number {
  return (
    (promptTokens / 1_000_000) * PROMPT_RATE_PER_1M_USD +
    (completionTokens / 1_000_000) * COMPLETION_RATE_PER_1M_USD
  );
}
