import * as React from 'react'

import { Dialog, DialogContent, DefaultDialogFooter } from '../dialog'
import { IForkSyncSummary } from '../../models/fork-sync'

interface IForkSyncSummaryDialogProps {
  readonly summary: IForkSyncSummary
  readonly onDismissed: () => void
}

export function ForkSyncSummaryDialog({
  summary,
  onDismissed,
}: IForkSyncSummaryDialogProps) {
  const title =
    summary.stoppedEntry === undefined
      ? 'Fork sync complete'
      : 'Fork sync stopped'

  return (
    <Dialog
      id="fork-sync-summary"
      title={title}
      onDismissed={onDismissed}
      type={summary.stoppedEntry === undefined ? 'normal' : 'warning'}
    >
      <DialogContent>
        <div className="fork-sync-summary">
          <div>
            <strong>{summary.syncedCount}</strong> branches synced
          </div>
          <div>
            <strong>{summary.upToDateCount}</strong> branches already up to date
          </div>
          <div>
            <strong>{summary.skippedCount}</strong> branches skipped
          </div>
          {summary.stoppedEntry !== undefined ? (
            <p className="fork-sync-summary-stopped">
              Sync stopped on <strong>{summary.stoppedEntry.branchName}</strong>
              . {summary.stoppedEntry.reason}
            </p>
          ) : null}
        </div>
      </DialogContent>
      <DefaultDialogFooter />
    </Dialog>
  )
}
