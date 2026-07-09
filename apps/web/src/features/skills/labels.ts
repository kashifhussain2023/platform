import type { SkillCategory } from '@vaep/types';

/** Tailwind classes for the category badge, keyed by category. */
export const CATEGORY_STYLES: Record<SkillCategory, string> = {
  communication: 'bg-blue-100 text-blue-700',
  payments: 'bg-purple-100 text-purple-700',
  development: 'bg-gray-200 text-gray-700',
  utility: 'bg-teal-100 text-teal-700',
};

/** "communication" → "Communication". */
export function formatCategory(category: SkillCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}
