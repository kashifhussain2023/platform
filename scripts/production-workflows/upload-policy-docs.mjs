#!/usr/bin/env node
/**
 * Uploads placeholder policy documents (Leave/Offer/Salary Band/Payroll/
 * Performance/Promotion/Transfer/DevOps Hiring) to Knowledge so RETRIEVE
 * nodes in the production workflows have real content to search —
 * illustrative content, replace with your real policies whenever you have
 * them. Idempotent: skips any filename already present.
 *
 * Run: node scripts/production-workflows/upload-policy-docs.mjs
 */
import { section, info, kashifCompany } from '../edge-case-tests/lib/harness.mjs';

const POLICIES = {
  'DevOps Hiring Policy.txt': `DEVOPS HIRING POLICY (Kashif Recruiting IT Services, illustrative)

Eligible Position: DevOps Engineer (a SEPARATE track from the Backend Engineering hiring policy — do not score DevOps candidates against the backend salary bands).

Minimum Experience: 4 years of professional DevOps / SRE / infrastructure engineering experience.

Required Skills: CI/CD pipeline design, containerization (Docker/Kubernetes), infrastructure-as-code (Terraform/Ansible/CloudFormation), cloud platforms (AWS/Azure/GCP), monitoring/observability (Prometheus/Grafana/ELK stack).

Salary Bands (Illustrative, INR LPA):
- DevOps Engineer (4-6 yrs): 12-20
- Senior DevOps Engineer (6-9 yrs): 20-32
- Lead DevOps Engineer (9-12 yrs): 32-45
- Principal DevOps Engineer (12+ yrs): 45+

Candidates should be evaluated against the band matching their years of relevant DevOps/infrastructure experience.`,

  'Leave Policy.txt': `LEAVE POLICY (Kashif Recruiting IT Services, illustrative)
- Employees accrue 1.5 paid leave days per month (18 days/year).
- Leave requests must be submitted at least 3 working days in advance for planned leave; same-day requests require manager sign-off.
- Requests for 5 or fewer consecutive days, submitted with adequate notice and within the employee's accrued balance, are eligible for auto-approval.
- Requests exceeding the accrued balance, exceeding 5 consecutive days, or with less than 3 days' notice are routed for manual review.
- Sick leave of 1-2 days does not require advance notice.`,

  'Offer Policy.txt': `OFFER POLICY (Kashif Recruiting IT Services, illustrative)
- Offers are extended only after the candidate clears technical screening and the hiring manager's interview.
- The offered salary must fall within the approved Salary Band for the role and experience level (see the "KASHIF RECRUITING — HIRING POLICY" document's Salary Bands table — the authoritative one; do not create a separate/duplicate salary-band document, it will conflict with RETRIEVE).
- Offers exceeding the top of the band require Director approval before being sent.
- Standard notice-period buy-out is not offered unless approved by HR leadership.
- Candidates requesting a notice period longer than 60 days require additional hiring-manager approval.`,

  'Payroll Policy.txt': `PAYROLL POLICY (Kashif Recruiting IT Services, illustrative)
- Salaries are disbursed on the last working day of each month.
- Payroll runs are validated against active headcount, approved salary changes, and statutory deductions (PF, professional tax, TDS) before disbursal.
- Any month-over-month payroll variance greater than 10% for an individual employee must be flagged for Finance review before processing.
- Reimbursements are processed alongside the next payroll cycle if submitted with valid receipts at least 5 working days before month-end.`,

  'Performance Policy.txt': `PERFORMANCE REVIEW POLICY (Kashif Recruiting IT Services, illustrative)
- Performance reviews are conducted monthly based on KPI attainment (tasks completed, success rate, approvals pending).
- Employees meeting or exceeding 80% of their KPI targets receive a 'Meets/Exceeds Expectations' rating.
- Employees below 50% attainment for two consecutive review cycles are flagged for a performance improvement plan (PIP).
- Reviews must be approved by the employee's manager before being shared with the employee.`,

  'Promotion Policy.txt': `PROMOTION POLICY (Kashif Recruiting IT Services, illustrative)
- Employees are eligible for promotion after a minimum of 12 months in their current role with a 'Meets/Exceeds Expectations' rating in their last two reviews.
- Promotions require sign-off from both the employee's manager and a Director, plus HR.
- Promotion moves the employee's salary to at least the minimum of the next Salary Band level.
- Employees with any open performance improvement plan (PIP) are not eligible for promotion.`,

  'Transfer Policy.txt': `INTERNAL TRANSFER POLICY (Kashif Recruiting IT Services, illustrative)
- Employees are eligible to request an internal transfer after a minimum of 6 months in their current role.
- Transfers require approval from both the current manager and the receiving team's manager, followed by HR sign-off.
- Employees with an active performance improvement plan (PIP) require additional HR review before a transfer is approved.
- Transfers should not result in a salary decrease; if the new role's band is lower, the current salary is red-circled (frozen) until the band catches up.`,
};

section('Upload placeholder policy documents');

const { client } = await kashifCompany();
const existing = await client.get('/knowledge/documents');
const existingNames = new Set(existing.map((d) => d.filename));

for (const [filename, content] of Object.entries(POLICIES)) {
  if (existingNames.has(filename)) {
    info(`Skipping "${filename}" — already uploaded.`);
    continue;
  }
  const form = new FormData();
  form.append('file', new Blob([content], { type: 'text/plain' }), filename);
  const doc = await client.post('/knowledge/documents', form);
  info(`Uploaded "${filename}" -> ${doc.id} (status: ${doc.status})`);
}

info('Done. Re-run any time — already-uploaded filenames are skipped.');
