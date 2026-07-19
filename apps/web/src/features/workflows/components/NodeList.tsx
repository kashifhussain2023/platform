'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react';
import type {
  NodeType,
  WorkflowDto,
  WorkflowEdge,
  WorkflowNode,
} from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useUpdateWorkflow } from '../hooks';
import { NODE_TYPES } from '../schemas';
import { NODE_HINTS, NODE_ICONS, NODE_LABELS, NODE_TONES, defaultConfig } from '../labels';
import { NodeEditor } from './NodeEditor';

// Monotonic suffix so ids stay unique even within the same millisecond.
let seq = 0;
function newId(): string {
  seq += 1;
  return `node_${Date.now()}_${seq}`;
}

/** Step choices exclude TRIGGER (the fixed, always-first entry node). */
const STEP_TYPES: NodeType[] = NODE_TYPES.filter((t) => t !== 'TRIGGER');

/**
 * The engine already runs a CONDITION node's two branch-tagged edges
 * correctly (a real marketplace template proves it) — this is the one bit of
 * UI needed to actually author one. Shows the Yes/No path if it already
 * exists (which step it leads to), or a button to add it if it doesn't.
 */
function BranchPaths({
  conditionId,
  edges,
  nodes,
  onAddBranch,
}: {
  conditionId: string;
  edges: WorkflowEdge[];
  nodes: WorkflowNode[];
  onAddBranch: (branch: 'true' | 'false') => void;
}) {
  const branches: Array<{ label: string; value: 'true' | 'false' }> = [
    { label: 'Yes', value: 'true' },
    { label: 'No', value: 'false' },
  ];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
      <span className="text-xs font-medium text-zinc-500">Branches:</span>
      {branches.map(({ label, value }) => {
        const edge = edges.find(
          (e) => e.from === conditionId && e.branch === value,
        );
        const target = edge ? nodes.find((n) => n.id === edge.to) : undefined;
        return edge && target ? (
          <span
            key={value}
            className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-zinc-300"
          >
            {label} → {NODE_LABELS[target.type]}
          </span>
        ) : (
          <button
            key={value}
            type="button"
            onClick={() => onAddBranch(value)}
            className="rounded-lg border border-dashed border-white/[0.15] px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-white/30 hover:text-white"
          >
            + Add {label} path
          </button>
        );
      })}
    </div>
  );
}

/** Seed the editor from the persisted definition, guaranteeing a TRIGGER leads. */
function seedNodes(workflow: WorkflowDto): WorkflowNode[] {
  const existing = workflow.definition?.nodes ?? [];
  if (existing.length === 0) {
    return [{ id: newId(), type: 'TRIGGER', config: {} }];
  }
  if (existing.some((n) => n.type === 'TRIGGER')) {
    return existing;
  }
  return [{ id: newId(), type: 'TRIGGER', config: {} }, ...existing];
}

/**
 * Seed edges from the persisted definition VERBATIM (including CONDITION
 * true/false branches) — never rebuilt from list order. `seedNodes` above only
 * synthesizes a node when NOTHING was persisted (a single TRIGGER, no edges
 * needed yet) or when a TRIGGER was missing (prepended — link it to what is
 * now the second node so the graph isn't disconnected).
 */
function seedEdges(workflow: WorkflowDto, nodes: WorkflowNode[]): WorkflowEdge[] {
  const persisted = workflow.definition?.edges ?? [];
  const hadTrigger = (workflow.definition?.nodes ?? []).some(
    (n) => n.type === 'TRIGGER',
  );
  if (!hadTrigger && nodes.length > 1) {
    return [{ from: nodes[0].id, to: nodes[1].id }, ...persisted];
  }
  return persisted;
}

/**
 * A LINEAR no-code step builder: ordered steps starting with a fixed TRIGGER,
 * add-step (choose type), per-step NodeEditor, reorder up/down (buttons, not a
 * drag-drop lib), delete, then Save. Edges are seeded from — and saved as —
 * whatever was actually persisted (including CONDITION true/false branches);
 * this component only ever ADDS an edge for a brand-new step or BRIDGES the
 * gap left by a deleted one. It never rebuilds the whole edge list from the
 * visual order, so editing an unrelated field (e.g. an Approval step's config)
 * and hitting Save can't silently flatten/destroy existing branching — a
 * visual drag-drop canvas for editing branch targets directly is a TODO.
 */
export function NodeList({ workflow }: { workflow: WorkflowDto }) {
  const [nodes, setNodes] = useState<WorkflowNode[]>(() => seedNodes(workflow));
  const [edges, setEdges] = useState<WorkflowEdge[]>(() =>
    seedEdges(workflow, seedNodes(workflow)),
  );
  const [addType, setAddType] = useState<NodeType>('AI_STEP');
  const update = useUpdateWorkflow();

  const addStep = () => {
    const prev = nodes[nodes.length - 1];
    const node: WorkflowNode = {
      id: newId(),
      type: addType,
      name: '',
      config: defaultConfig(addType),
    };
    setNodes((cur) => [...cur, node]);
    // Only chain it after `prev` if `prev` is a dead end — a CONDITION (or any
    // node) that already has an outgoing edge keeps its existing wiring.
    setEdges((cur) =>
      cur.some((e) => e.from === prev.id)
        ? cur
        : [...cur, { from: prev.id, to: node.id }],
    );
  };

  /**
   * The engine has always supported real branching (a CONDITION node's two
   * outgoing edges tagged branch:'true'/'false') — this UI just never had a
   * button for it. Adds a new NOTIFY placeholder step (the simplest node to
   * configure) as that branch's target; the user can change its type/config
   * like any other step afterward.
   */
  const addBranch = (conditionId: string, branch: 'true' | 'false') => {
    const node: WorkflowNode = {
      id: newId(),
      type: 'NOTIFY',
      name: '',
      config: defaultConfig('NOTIFY'),
    };
    setNodes((cur) => [...cur, node]);
    setEdges((cur) => [...cur, { from: conditionId, to: node.id, branch }]);
  };

  const updateNode = (id: string, next: WorkflowNode) =>
    setNodes((cur) => cur.map((n) => (n.id === id ? next : n)));

  const removeNode = (id: string) => {
    setNodes((cur) => cur.filter((n) => n.id !== id));
    setEdges((cur) => {
      const incoming = cur.filter((e) => e.to === id);
      const outgoing = cur.filter((e) => e.from === id);
      const remaining = cur.filter((e) => e.from !== id && e.to !== id);
      // Bridge each predecessor to each successor so removing a middle node
      // doesn't leave a dangling chain (preserves the predecessor's branch).
      const bridged = incoming.flatMap((inc) =>
        outgoing.map((out) => ({ from: inc.from, to: out.to, branch: inc.branch })),
      );
      return [...remaining, ...bridged];
    });
  };

  // Swap a step with its neighbour; index 0 (TRIGGER) is pinned. Edges
  // reference node ids, not positions, so reordering never touches them.
  const move = (index: number, dir: -1 | 1) =>
    setNodes((cur) => {
      const target = index + dir;
      if (target < 1 || target >= cur.length) {
        return cur;
      }
      const copy = [...cur];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });

  const onSave = () => {
    update.mutate({
      id: workflow.id,
      // expectedUpdatedAt: catches a concurrent edit from another tab/person
      // (409 instead of silently overwriting their change).
      data: { definition: { nodes, edges }, expectedUpdatedAt: workflow.updatedAt },
    });
  };

  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-400">Steps</h2>
        <div className="flex items-center gap-2">
          <div className="w-44">
            <select
              className="field-modern text-sm"
              value={addType}
              onChange={(e) => setAddType(e.target.value as NodeType)}
            >
              {STEP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {NODE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={addStep}
            className="rounded-lg border border-white/[0.1] px-3.5 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-white/[0.2] hover:text-white"
          >
            + Add step
          </button>
          <Button variant="violet" onClick={onSave} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {update.isError && (
        <p className="mb-3 text-sm text-red-400">
          {update.error?.message ?? 'Could not save workflow'}
        </p>
      )}
      {update.isSuccess && !update.isPending && (
        <p className="mb-3 text-sm text-green-400">Saved.</p>
      )}
      {workflow.warnings.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-400">
          {workflow.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}

      <ol className="space-y-3">
        {nodes.map((node, index) => {
          const isTrigger = node.type === 'TRIGGER';
          const Icon = NODE_ICONS[node.type];
          return (
            <li key={node.id} className="relative">
              {index > 0 && (
                <div
                  aria-hidden
                  className="absolute -top-3 left-[34px] h-3 w-px bg-white/[0.1]"
                />
              )}
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.14]">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${NODE_TONES[node.type]}`}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {index + 1}. {NODE_LABELS[node.type]}
                      </p>
                      <p className="truncate text-xs text-zinc-500">
                        {node.name || NODE_HINTS[node.type]}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index <= 1}
                      aria-label="Move up"
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === 0 || index === nodes.length - 1}
                      aria-label="Move down"
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    {!isTrigger && (
                      <button
                        type="button"
                        onClick={() => removeNode(node.id)}
                        aria-label="Delete step"
                        className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:text-red-400"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <ChevronRight className="ml-1 h-4 w-4 text-zinc-700" aria-hidden />
                  </div>
                </div>
                <NodeEditor
                  node={node}
                  onChange={(next) => updateNode(node.id, next)}
                />
                {node.type === 'CONDITION' && (
                  <BranchPaths
                    conditionId={node.id}
                    edges={edges}
                    nodes={nodes}
                    onAddBranch={(branch) => addBranch(node.id, branch)}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
