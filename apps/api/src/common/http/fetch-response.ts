/**
 * Minimal shape of the global `fetch()` Response actually used across the
 * codebase. Cast every `fetch()` result through this instead of trusting the
 * ambient global `Response` type — `@types/node`'s fetch typings live behind
 * a `typesVersions` redirect keyed on the resolved TypeScript version, which
 * can differ between build environments (observed dropping `ok`/`status`/
 * `text`/`json` on Vercel's Node function type-check pass, which resolves a
 * different tsconfig than our own `nest build`).
 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export function asFetchResponse(res: unknown): FetchResponseLike {
  return res as FetchResponseLike;
}
