'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/Button';
import { useSearchKnowledge } from '../hooks';
import { searchSchema, type SearchQueryDto } from '../schemas';

export function SearchPanel() {
  const search = useSearchKnowledge();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SearchQueryDto>({
    resolver: zodResolver(searchSchema),
    defaultValues: { query: '' },
  });

  const onSubmit = handleSubmit((values) => {
    search.mutate({ query: values.query });
  });

  const results = search.data;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-gray-500">
        Search knowledge base
      </h2>
      <form onSubmit={onSubmit} className="flex gap-2" noValidate>
        <input
          type="text"
          placeholder="Ask a question…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          {...register('query')}
        />
        <Button type="submit" disabled={search.isPending}>
          {search.isPending ? 'Searching…' : 'Search'}
        </Button>
      </form>
      {errors.query && (
        <p className="mt-1 text-sm text-red-600">{errors.query.message}</p>
      )}
      {search.isError && (
        <p className="mt-2 text-sm text-red-600">
          {search.error?.message ?? 'Search failed'}
        </p>
      )}

      {results && (
        <div className="mt-4 space-y-3">
          {results.length === 0 ? (
            <p className="text-sm text-gray-500">No matches found.</p>
          ) : (
            results.map((r) => (
              <div
                key={r.chunkId}
                className="rounded-md border border-gray-100 bg-gray-50 p-3"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">
                    doc {r.documentId.slice(0, 8)}
                  </span>
                  <span className="text-xs font-medium text-brand-700">
                    {(r.score * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="text-sm text-gray-700">{r.content}</p>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
