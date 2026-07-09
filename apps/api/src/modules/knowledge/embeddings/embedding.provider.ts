/**
 * Swappable embedding backend (mirrors the auth AuthProvider pattern). The
 * active implementation is chosen by the `EMBEDDINGS_PROVIDER` env var and
 * provided as a singleton under the EMBEDDING_PROVIDER DI token.
 */
export interface EmbeddingProvider {
  /** Output dimensionality — must match the pgvector column (384). */
  readonly dim: number;
  /** Embed a batch of texts, returning one vector per input (order-preserved). */
  embed(texts: string[]): Promise<number[][]>;
}

/** DI token for the active EmbeddingProvider implementation. */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** Fixed embedding size across all providers (all-MiniLM-L6-v2 / OpenAI-384). */
export const EMBEDDING_DIM = 384;
