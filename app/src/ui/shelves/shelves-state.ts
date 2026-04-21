import { ConflictState } from '../../lib/app-state'

interface IShelvesSectionSignals {
  readonly hasCheckedOutBranch: boolean
  readonly conflictState: ConflictState | null
  readonly isCommitting: boolean
  readonly isPushPullFetchInProgress: boolean
}

export interface IShelvesSectionState {
  readonly canUnshelve: boolean
  readonly isBusy: boolean
}

export function getShelvesSectionState(
  signals: IShelvesSectionSignals
): IShelvesSectionState {
  return {
    canUnshelve:
      signals.hasCheckedOutBranch && signals.conflictState === null,
    isBusy:
      signals.isCommitting || signals.isPushPullFetchInProgress,
  }
}
