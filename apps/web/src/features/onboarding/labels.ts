import type { Department } from '@vaep/types';

/** SALES → "Sales", CUSTOMER_SUPPORT → "Customer support". */
export function formatDepartment(dept: Department | string): string {
  return dept
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

/** Company size options for the register + business-profile forms. */
export const COMPANY_SIZES: readonly string[] = [
  '1-10',
  '11-50',
  '51-200',
  '201-1000',
  '1000+',
] as const;
