import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, forwardRef } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

import { EntryRelationTreeNode } from '../../core/models/metadata.models';

@Component({
  selector: 'app-entry-relation-tree-node',
  standalone: true,
  imports: [CommonModule, TranslateModule, forwardRef(() => EntryRelationTreeNodeComponent)],
  templateUrl: './entry-relation-tree-node.component.html',
  styleUrl: './entry-relation-tree-node.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryRelationTreeNodeComponent {
  @Input({ required: true }) node!: EntryRelationTreeNode;
  @Input() isRoot = false;
  @Input() depth = 0;

  trackChild(index: number): number {
    return index;
  }

  referenceHintKey(): string | null {
    if (!this.node.is_reference) {
      return null;
    }

    if (this.node.reference_reason === 'cycle') {
      return 'relationTree.reference.cycle';
    }

    if (this.node.reference_reason === 'duplicate') {
      return 'relationTree.reference.duplicate';
    }

    return 'relationTree.reference.generic';
  }

  relationDirectionLabelKey(): string {
    return this.node.via_relation?.direction === 'incoming'
      ? 'relationTree.direction.incoming'
      : 'relationTree.direction.outgoing';
  }

  schemaName(): string {
    return this.node.entry.schema?.name?.trim() || `#${this.node.entry.schema_id}`;
  }

  schemaDescription(): string | null {
    return this.node.entry.schema?.description?.trim() || null;
  }

  hasChildren(): boolean {
    return !this.node.is_reference && this.node.children.length > 0;
  }

  useCompactChildrenLayout(): boolean {
    return this.depth < 2 && this.node.children.length > 1;
  }
}
