import { DarkKicker, DarkHl } from './DarkSectionHeading';
import { WorkflowDiagram } from './WorkflowDiagram';

/** "No-code workflow builder" — headline + link + trigger/AI/condition diagram. */
export function WorkflowBuilderSection() {
  return (
    <section className="border-t border-white/[0.06] py-20 sm:py-28">
      <div className="mx-auto max-w-[1440px] px-8">
        <DarkKicker>No-code workflow builder</DarkKicker>
        <h2 className="mt-3 max-w-xl text-[28px] font-bold leading-tight tracking-tight text-white sm:text-4xl">
          Build powerful <DarkHl>workflows</DarkHl> without writing code
        </h2>
        <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-zinc-400">
          Automate repetitive tasks with our drag-and-drop workflow builder. Trigger actions, add
          AI steps, integrate tools, and get work done.
        </p>
        <a href="#" className="mt-4 inline-block text-sm font-medium text-violet-secondary hover:text-white">
          See workflow builder in action →
        </a>

        <div className="mt-10">
          <WorkflowDiagram />
        </div>
      </div>
    </section>
  );
}
