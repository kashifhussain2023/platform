import { BadRequestException } from '@nestjs/common';
import type { WorkflowDefinition } from '@vaep/types';

/**
 * Structural checks shared by manual creation/update (WorkflowsService) and
 * AI generation (WorkflowGeneratorService): every node id is unique, and every
 * edge points at a node id that actually exists in the same definition.
 */
export function validateDefinitionStructure(definition: WorkflowDefinition): void {
  const ids = new Set<string>();
  for (const node of definition.nodes) {
    if (ids.has(node.id)) {
      throw new BadRequestException(
        `Duplicate node id "${node.id}" in workflow definition`,
      );
    }
    ids.add(node.id);
  }
  for (const edge of definition.edges) {
    if (!ids.has(edge.from)) {
      throw new BadRequestException(
        `Edge references unknown node id "${edge.from}"`,
      );
    }
    if (!ids.has(edge.to)) {
      throw new BadRequestException(
        `Edge references unknown node id "${edge.to}"`,
      );
    }
  }
}
