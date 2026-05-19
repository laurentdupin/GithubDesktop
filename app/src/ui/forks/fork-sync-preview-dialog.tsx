import * as React from 'react'

import {
  DefaultDialogFooter,
  Dialog,
  DialogContent,
  DialogFooter,
} from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import {
  IForkSyncPreviewEntry,
  IForkSyncPreviewStats,
  sortForkSyncPreviewEntries,
  summarizeForkSyncPreviewEntries,
} from '../../models/fork-sync'

interface IForkSyncPreviewDialogProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly onDismissed: () => void
}

interface IForkSyncPreviewDialogState {
  readonly loading: boolean
  readonly starting: boolean
  readonly entries: ReadonlyArray<IForkSyncPreviewEntry>
  readonly error?: Error
}

export class ForkSyncPreviewDialog extends React.Component<
  IForkSyncPreviewDialogProps,
  IForkSyncPreviewDialogState
> {
  public constructor(props: IForkSyncPreviewDialogProps) {
    super(props)

    this.state = {
      loading: true,
      starting: false,
      entries: [],
    }
  }

  public componentDidMount() {
    void this.loadPreview()
  }

  public render() {
    const { loading, error, starting } = this.state

    return (
      <Dialog
        id="fork-sync-preview"
        title="Sync fork from parent repository"
        onDismissed={this.props.onDismissed}
        onSubmit={error === undefined ? this.onSubmit : undefined}
        loading={loading || starting}
        dismissDisabled={starting}
        disabled={starting}
        type={error === undefined ? 'normal' : 'error'}
      >
        {error === undefined ? this.renderContent() : this.renderError(error)}
      </Dialog>
    )
  }

  private async loadPreview() {
    try {
      const entries = await this.props.dispatcher.loadForkSyncPreview(
        this.props.repository
      )
      const stats = summarizeForkSyncPreviewEntries(entries)
      const displayEntries = sortForkSyncPreviewEntries(
        entries.filter(
          entry => entry.status === 'needs-sync' || entry.status === 'conflicts'
        )
      )

      log.info(
        `[ForkSync] Dialog loaded for ${this.props.repository.path}: displayed=${displayEntries.length}, readyToMerge=${stats.readyToMergeCount}, conflicts=${stats.conflictsCount}, upToDate=${stats.upToDateCount}, skippedNoLocal=${stats.skippedNoLocalCount}, skippedDivergedOrigin=${stats.skippedDivergedOriginCount}`
      )

      this.setState({
        entries,
        loading: false,
      })
    } catch (error) {
      log.error('Failed to load fork sync preview', error)
      this.setState({
        error: error instanceof Error ? error : new Error(`${error}`),
        loading: false,
      })
    }
  }

  private onSubmit = async () => {
    this.setState({ starting: true })
    await this.props.dispatcher.startForkUpdate(
      this.props.repository,
      this.state.entries
    )
    this.props.onDismissed()
  }

  private get syncableEntries() {
    return this.state.entries.filter(
      entry => entry.status === 'needs-sync' || entry.status === 'conflicts'
    )
  }

  private get displayEntries() {
    return sortForkSyncPreviewEntries(this.syncableEntries)
  }

  private get previewStats(): IForkSyncPreviewStats {
    return summarizeForkSyncPreviewEntries(this.state.entries)
  }

  private renderContent() {
    const { entries, loading, starting } = this.state
    const displayEntries = this.displayEntries
    const stats = this.previewStats
    const syncableEntries = this.syncableEntries

    return (
      <>
        <DialogContent>
          <p>
            Review the branches that can be merged from the parent repository
            into your fork. Matching branches are compared between
            <strong> origin</strong> and <strong>upstream</strong>, and only
            locally available branches aligned with <strong>origin</strong> can
            be synced automatically.
          </p>

          <div className="fork-sync-preview-stats">
            <div className="fork-sync-preview-stat">
              <span className="fork-sync-preview-stat-label">Ready to merge</span>
              <strong className="fork-sync-preview-stat-value">
                {stats.readyToMergeCount}
              </strong>
            </div>
            <div className="fork-sync-preview-stat">
              <span className="fork-sync-preview-stat-label">Will conflict</span>
              <strong className="fork-sync-preview-stat-value">
                {stats.conflictsCount}
              </strong>
            </div>
            <div className="fork-sync-preview-stat">
              <span className="fork-sync-preview-stat-label">
                Already up to date
              </span>
              <strong className="fork-sync-preview-stat-value">
                {stats.upToDateCount}
              </strong>
            </div>
            <div className="fork-sync-preview-stat">
              <span className="fork-sync-preview-stat-label">
                Skipped, no local branch
              </span>
              <strong className="fork-sync-preview-stat-value">
                {stats.skippedNoLocalCount}
              </strong>
            </div>
            <div className="fork-sync-preview-stat">
              <span className="fork-sync-preview-stat-label">
                Skipped, diverged from origin
              </span>
              <strong className="fork-sync-preview-stat-value">
                {stats.skippedDivergedOriginCount}
              </strong>
            </div>
          </div>

          {displayEntries.length > 0 ? (
            <>
              <p className="fork-sync-preview-caption">
                Only branches that would be synced are listed below.
              </p>

              <div className="fork-sync-preview-table">
                <div className="fork-sync-preview-list" role="table">
                  <div className="fork-sync-preview-header" role="row">
                    <span role="columnheader">Branch</span>
                    <span role="columnheader">Status</span>
                    <span role="columnheader">Parent commits</span>
                    <span role="columnheader">Push</span>
                  </div>
                  {displayEntries.map(entry => this.renderEntry(entry))}
                </div>
              </div>
            </>
          ) : null}

          {!loading && entries.length === 0 ? (
            <p className="fork-sync-preview-empty">
              No matching branches were found on both origin and upstream.
            </p>
          ) : null}

          {!loading && entries.length > 0 && displayEntries.length === 0 ? (
            <p className="fork-sync-preview-empty">
              No branches can be synced automatically right now. The counts
              above show why the matching branches were excluded.
            </p>
          ) : null}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Start Sync"
            okButtonDisabled={
              loading || starting || syncableEntries.length === 0
            }
          />
        </DialogFooter>
      </>
    )
  }

  private renderEntry(entry: IForkSyncPreviewEntry) {
    return (
      <div
        key={entry.branchName}
        className="fork-sync-preview-row"
        role="row"
      >
        <div className="fork-sync-preview-branch" role="cell">
          <strong>{entry.branchName}</strong>
          <div className="fork-sync-preview-refs">
            <span>{entry.localRef ?? 'No local branch'}</span>
            <span>{entry.originRef}</span>
            <span>{entry.upstreamRef}</span>
          </div>
        </div>
        <span role="cell">{this.renderStatus(entry)}</span>
        <span role="cell">{entry.commitCountFromParent}</span>
        <span role="cell">{entry.willPush ? 'Yes' : 'No'}</span>
      </div>
    )
  }

  private renderStatus(entry: IForkSyncPreviewEntry) {
    switch (entry.status) {
      case 'needs-sync':
        return 'Ready to merge'
      case 'up-to-date':
        return 'Already up to date'
      case 'conflicts':
        return entry.conflictedFiles !== undefined &&
          entry.conflictedFiles > 0
          ? `Will conflict (${entry.conflictedFiles})`
          : 'Will conflict'
      case 'skipped-no-local':
      case 'skipped-diverged-origin':
        return entry.skipReason ?? 'Skipped'
    }
  }

  private renderError(error: Error) {
    return (
      <>
        <DialogContent>
          <p>Unable to prepare the fork sync preview.</p>
          <details>
            <summary>Error details</summary>
            <pre className="error">{error.message}</pre>
          </details>
        </DialogContent>
        <DefaultDialogFooter />
      </>
    )
  }
}
