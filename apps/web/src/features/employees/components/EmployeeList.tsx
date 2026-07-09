'use client';

import { useEmployees } from '../hooks';
import { EmployeeCard } from './EmployeeCard';

/** The roster of AI employees for the tenant. */
export function EmployeeList() {
  const { data: employees, isLoading } = useEmployees();

  if (isLoading) {
    return <p className="text-sm text-gray-500">Loading employees…</p>;
  }

  if (!employees || employees.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No employees yet. Hire one above to get started.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
      {employees.map((employee) => (
        <EmployeeCard key={employee.id} employee={employee} />
      ))}
    </ul>
  );
}
