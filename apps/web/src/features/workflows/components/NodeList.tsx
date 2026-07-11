'use client';

import { useState } from 'react';
import type {
  NodeType,
  WorkflowDto,
  WorkflowEdge,
  WorkflowNode,
} from '@vaep/types';
import { Button } from '@/components/ui/Button';
import { useUpdateWorkflow } from '../hooks';
import { NODE_TYPES } from '../schemas';
import { NODE_LABELS, defaultConfig } from '../labels';
import { NodeEditor } from './NodeEditor';

// Monotonic suffix so ids stay unique even within the same millisecond.
let seq = 0;
function newId(): string {
  seq += 1;
  return `node_${Date.now()}_${seq}`;
}

/** Step choices exclude TRIGGER (the fixed, always-first entry node). */
const STEP_TYPES: NodeType[] = NODE_TYPES.filter((t) => t !== 'TRIGGER');

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
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-gray-500">Steps</h2>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            value={addType}
            onChange={(e) => setAddType(e.target.value as NodeType)}
          >
            {STEP_TYPES.map((t) => (
              <option key={t} value={t}>
                {NODE_LABELS[t]}
              </option>
            ))}
          </select>
          <Button variant="ghost" onClick={addStep}>
            + Add step
          </Button>
          <Button onClick={onSave} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {update.isError && (
        <p className="mb-3 text-sm text-red-600">
          {update.error?.message ?? 'Could not save workflow'}
        </p>
      )}
      {update.isSuccess && !update.isPending && (
        <p className="mb-3 text-sm text-green-700">Saved.</p>
      )}

      <ol className="space-y-3">
        {nodes.map((node, index) => {
          const isTrigger = node.type === 'TRIGGER';
          return (
            <li
              key={node.id}
              className="rounded-lg border border-gray-200 bg-gray-50 p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-medium text-white">
                    {index + 1}
                  </span>
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                    {NODE_LABELS[node.type]}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => move(index, -1)}
                    disabled={index <= 1}
                    aria-label="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => move(index, 1)}
                    disabled={index === 0 || index === nodes.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                  {!isTrigger && (
                    <Button
                      variant="ghost"
                      onClick={() => removeNode(node.id)}
                      aria-label="Delete step"
                    >
                      ✕
                    </Button>
                  )}
                </div>
              </div>
              <NodeEditor
                node={node}
                onChange={(next) => updateNode(node.id, next)}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
