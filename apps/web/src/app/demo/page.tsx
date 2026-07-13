import type { Metadata } from 'next';
import { DemoPlayer } from '@/components/marketing-dark/demo/DemoPlayer';

export const metadata: Metadata = {
  title: 'Orlixa — Product demo',
  description: 'How Orlixa works, in six steps.',
};

/** Self-playing product explainer at /demo (screen-record to MP4). */
export default function DemoPage() {
  return <DemoPlayer />;
}
