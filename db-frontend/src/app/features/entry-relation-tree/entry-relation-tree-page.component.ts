import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { EntryRelationTreeNode, EntryRelationTreeReferenceReason, EntryRelationTreeResponse } from '../../core/models/metadata.models';
import { EntryService } from '../../core/services/entry.service';
import { EntryRelationTreeNodeComponent } from './entry-relation-tree-node.component';

interface TreeOccurrence {
  key: string;
  depth: number;
  order: number;
  node: EntryRelationTreeNode;
}

interface PreferredNodeConfig {
  preferredKey: string;
  sourceNode: EntryRelationTreeNode;
  sourceKey: string;
}

@Component({
  selector: 'app-entry-relation-tree-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, TranslateModule, EntryRelationTreeNodeComponent],
  templateUrl: './entry-relation-tree-page.component.html',
  styleUrl: './entry-relation-tree-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EntryRelationTreePageComponent {
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly entryService = inject(EntryService);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly form = this.fb.nonNullable.group({
    entryId: ['', [Validators.required]]
  });

  readonly tree = signal<EntryRelationTreeResponse | null>(null);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly currentEntryId = signal<string | null>(null);
  private traversalOrder = 0;

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const entryId = params.get('entryId')?.trim() ?? '';
      this.form.controls.entryId.setValue(entryId, { emitEvent: false });
      this.currentEntryId.set(entryId || null);

      if (!entryId) {
        this.tree.set(null);
        this.errorMessage.set(null);
        this.isLoading.set(false);
        return;
      }

      void this.loadTree(entryId);
    });
  }

  async submit(): Promise<void> {
    this.form.markAllAsTouched();
    const entryId = this.form.controls.entryId.getRawValue().trim();
    if (!entryId) {
      return;
    }

    await this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { entryId },
      queryParamsHandling: 'merge'
    });
  }

  async refresh(): Promise<void> {
    const entryId = this.currentEntryId();
    if (!entryId) {
      return;
    }

    await this.loadTree(entryId);
  }

  hasLoadedTree(): boolean {
    return this.tree() !== null;
  }

  private async loadTree(entryId: string): Promise<void> {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      const tree = await firstValueFrom(this.entryService.getRelationTree(entryId));
      this.tree.set(this.normalizeTreePreference(tree));
    } catch (error) {
      this.tree.set(null);
      this.errorMessage.set(this.describeError(error));
    } finally {
      this.isLoading.set(false);
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 404) {
        return this.translate.instant('relationTree.errors.notFound');
      }

      if (error.status === 403) {
        return this.translate.instant('relationTree.errors.forbidden');
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return this.translate.instant('relationTree.errors.generic');
  }

  private normalizeTreePreference(response: EntryRelationTreeResponse): EntryRelationTreeResponse {
    this.traversalOrder = 0;
    const occurrences = new Map<string, TreeOccurrence[]>();
    this.collectOccurrences(response.tree, 0, 'root', occurrences);

    const preferredByEntryId = new Map<string, PreferredNodeConfig>();
    for (const [entryId, items] of occurrences.entries()) {
      const preferred = items.reduce((best, current) => this.compareOccurrence(current, best) < 0 ? current : best);
      const nonReference = [...items]
        .filter((item) => !item.node.is_reference)
        .sort((left, right) => this.compareOccurrence(left, right))[0];

      preferredByEntryId.set(entryId, {
        preferredKey: preferred.key,
        sourceNode: nonReference?.node ?? preferred.node,
        sourceKey: nonReference?.key ?? preferred.key
      });
    }

    return {
      ...response,
      tree: this.rebuildWithPreferredDepth(response.tree, 0, 'root', preferredByEntryId)
    };
  }

  private collectOccurrences(
    node: EntryRelationTreeNode,
    depth: number,
    key: string,
    occurrences: Map<string, TreeOccurrence[]>
  ): void {
    const entryId = String(node.entry.id);
    const list = occurrences.get(entryId) ?? [];
    list.push({
      key,
      depth,
      order: this.traversalOrder++,
      node
    });
    occurrences.set(entryId, list);

    node.children.forEach((child, index) => {
      this.collectOccurrences(child, depth + 1, `${key}.${index}`, occurrences);
    });
  }

  private rebuildWithPreferredDepth(
    node: EntryRelationTreeNode,
    depth: number,
    key: string,
    preferredByEntryId: Map<string, PreferredNodeConfig>
  ): EntryRelationTreeNode {
    const entryId = String(node.entry.id);
    const preferredConfig = preferredByEntryId.get(entryId);
    const isPreferredOccurrence = preferredConfig?.preferredKey === key;
    const sourceNode = preferredConfig?.sourceNode ?? node;
    const shouldExpand = isPreferredOccurrence && !sourceNode.is_reference;

    const nextChildren = shouldExpand
      ? sourceNode.children.map((child, index) =>
          this.rebuildWithPreferredDepth(child, depth + 1, `${preferredConfig?.sourceKey ?? key}.${index}`, preferredByEntryId)
        )
      : [];

    return {
      ...node,
      is_reference: shouldExpand ? false : true,
      reference_reason: shouldExpand ? null : this.resolveReferenceReason(node.reference_reason, depth),
      children: nextChildren
    };
  }

  private resolveReferenceReason(
    currentReason: EntryRelationTreeReferenceReason,
    depth: number
  ): EntryRelationTreeReferenceReason {
    if (currentReason === 'cycle') {
      return 'cycle';
    }

    return depth === 0 ? null : 'duplicate';
  }

  private compareOccurrence(left: TreeOccurrence, right: TreeOccurrence): number {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    if (left.node.is_reference !== right.node.is_reference) {
      return Number(left.node.is_reference) - Number(right.node.is_reference);
    }

    return left.order - right.order;
  }
}
