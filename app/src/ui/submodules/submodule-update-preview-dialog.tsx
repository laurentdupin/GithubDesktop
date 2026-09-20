import * as React from 'react'

import { Repository } from '../../models/repository'
import {
  ISubmoduleUpdateEntry,
  sortSubmoduleUpdates,
  summarizeSubmoduleUpdates,
} from '../../models/submodule-update'
import {
  DefaultDialogFooter,
  Dialog,
  DialogContent,
  DialogFooter,
} from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { TooltippedCommitSHA } from '../lib/tooltipped-commit-sha'
import { TooltippedContent } from '../lib/tooltipped-content'

interface ISubmoduleUpdatePreviewDialogProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly fetchRemotes: boolean
  readonly onDismissed: () => void
}

interface ISubmoduleUpdatePreviewDialogState {
  readonly loading: boolean
  readonly starting: boolean
  readonly entries: ReadonlyArray<ISubmoduleUpdateEntry>
  readonly error?: Error
}

export class SubmoduleUpdatePreviewDialog extends React.Component<
  ISubmoduleUpdatePreviewDialogProps,
  ISubmoduleUpdatePreviewDialogState
> {
  private isDialogMounted = false

  public constructor(props: ISubmoduleUpdatePreviewDialogProps) {
    super(props)
    this.state = { loading: true, starting: false, entries: [] }
  }

  public componentDidMount() {
    this.isDialogMounted = true
    void this.loadPreview()
  }

  public componentWillUnmount() {
    this.isDialogMounted = false
  }

  public render() {
    const { loading, starting, error } = this.state

    return (
      <Dialog
        id="submodule-update-preview"
        title="Update submodules from their remotes"
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

  private async loadPreview(fetchRemotes = this.props.fetchRemotes) {
    try {
      const entries = await this.props.dispatcher.loadSubmoduleUpdatePreview(
        this.props.repository,
        fetchRemotes
      )
      if (this.isDialogMounted) {
        this.props.dispatcher.markSubmoduleUpdatePreviewViewed(
          this.props.repository
        )
        this.setState({ entries, loading: false })
      }
    } catch (error) {
      if (this.isDialogMounted) {
        this.setState({
          error: error instanceof Error ? error : new Error(`${error}`),
          loading: false,
        })
      }
    }
  }

  private onFetchAgain = () => {
    this.setState({ loading: true, error: undefined })
    void this.loadPreview(true)
  }

  private get updateEntries() {
    return this.state.entries.filter(entry => entry.status === 'behind')
  }

  private onSubmit = async () => {
    this.setState({ starting: true })
    this.props.onDismissed()
    await this.props.dispatcher.applySubmoduleUpdates(
      this.props.repository,
      this.state.entries
    )
  }

  private renderContent() {
    const { entries, loading, starting } = this.state
    const stats = summarizeSubmoduleUpdates(entries)
    const displayEntries = sortSubmoduleUpdates(entries)
    return (
      <>
        <DialogContent>
          <p>
            Submodules are fetched recursively and compared with their own
            configured branches. Updates change submodule checkouts and leave
            the resulting gitlinks as local changes for you to commit. Diverged
            submodules are left unchanged for manual review. Ahead and behind
            values are commit distances from each configured branch, not counts
            of unpublished commits.
          </p>

          <div className="fork-sync-preview-stats">
            <div className="fork-sync-preview-stat">
              <span className="fork-sync-preview-stat-label">Can pull</span>
              <strong className="fork-sync-preview-stat-value">
                {stats.behindCount}
              </strong>
            </div>
            <div className="fork-sync-preview-stat">
              <span className="fork-sync-preview-stat-label">Needs merge</span>
              <strong className="fork-sync-preview-stat-value">
                {stats.divergedCount}
              </strong>
            </div>
            <div className="fork-sync-preview-stat">
              <span className="fork-sync-preview-stat-label">
                Ahead of branch
              </span>
              <strong className="fork-sync-preview-stat-value">
                {stats.aheadCount}
              </strong>
            </div>
            <div className="fork-sync-preview-stat">
              <span className="fork-sync-preview-stat-label">Up to date</span>
              <strong className="fork-sync-preview-stat-value">
                {stats.upToDateCount}
              </strong>
            </div>
            <div className="fork-sync-preview-stat">
              <span className="fork-sync-preview-stat-label">Blocked</span>
              <strong className="fork-sync-preview-stat-value">
                {stats.blockedCount}
              </strong>
            </div>
          </div>

          {displayEntries.length > 0 ? (
            <div className="fork-sync-preview-table">
              <div className="fork-sync-preview-list" role="table">
                <div className="submodule-update-header" role="row">
                  <span role="columnheader">Submodule</span>
                  <span role="columnheader">Branch</span>
                  <span role="columnheader">Local commit</span>
                  <span role="columnheader">Remote tip</span>
                  <span role="columnheader">State</span>
                </div>
                {displayEntries.map(entry => this.renderEntry(entry))}
              </div>
            </div>
          ) : !loading ? (
            <p className="fork-sync-preview-empty">
              This repository has no initialized submodules.
            </p>
          ) : null}
        </DialogContent>

        <DialogFooter>
          <div className="submodule-update-footer">
            <Button
              type="button"
              onClick={this.onFetchAgain}
              disabled={loading || starting}
            >
              {loading ? 'Fetching...' : 'Fetch Again'}
            </Button>
            <OkCancelButtonGroup
              okButtonText="Pull Submodules"
              okButtonDisabled={
                loading || starting || this.updateEntries.length === 0
              }
            />
          </div>
        </DialogFooter>
      </>
    )
  }

  private renderEntry(entry: ISubmoduleUpdateEntry) {
    const branch =
      entry.remoteName !== undefined && entry.branchName !== undefined
        ? `${entry.remoteName}/${entry.branchName}`
        : 'Not configured'

    return (
      <div key={entry.path} className="submodule-update-row" role="row">
        <div className="submodule-update-path" role="cell">
          <strong>{entry.path}</strong>
          {entry.reason !== undefined ? (
            <div className="fork-sync-preview-refs">{entry.reason}</div>
          ) : null}
        </div>
        <span role="cell">
          <TooltippedContent
            className="submodule-update-branch"
            tooltip={branch}
          >
            {branch}
          </TooltippedContent>
        </span>
        <span className="submodule-update-sha" role="cell">
          {this.renderCommit(entry.currentSha)}
        </span>
        <span className="submodule-update-sha" role="cell">
          {this.renderCommit(entry.remoteSha)}
        </span>
        <span className="submodule-update-state" role="cell">
          {this.getStatusLabel(entry)}
        </span>
      </div>
    )
  }

  private renderCommit(sha: string | undefined) {
    return sha === undefined ? (
      <span className="submodule-update-sha-unavailable">Unknown</span>
    ) : (
      <TooltippedCommitSHA commit={sha} asRef={true} />
    )
  }

  private getStatusLabel(entry: ISubmoduleUpdateEntry) {
    switch (entry.status) {
      case 'behind':
        return `${entry.behind} to pull`
      case 'ahead':
        return `${entry.ahead} ahead`
      case 'diverged':
        return 'Manual merge required'
      case 'up-to-date':
        return 'Up to date'
      case 'dirty':
        return 'Local changes'
      case 'branch-required':
        return 'Branch required'
      case 'uninitialized':
        return 'Not initialized'
    }
  }

  private renderError(error: Error) {
    return (
      <>
        <DialogContent>
          <p>Unable to fetch submodule branches.</p>
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
