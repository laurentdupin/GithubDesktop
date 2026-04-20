import { Branch, BranchType } from './branch'

export type ForkSyncBranchStatus =
  | 'needs-sync'
  | 'up-to-date'
  | 'conflicts'
  | 'skipped-no-local'
  | 'skipped-diverged-origin'

export interface IForkSyncPreviewEntry {
  readonly branchName: string
  readonly localRef: string | null
  readonly originRef: string
  readonly upstreamRef: string
  readonly status: ForkSyncBranchStatus
  readonly commitCountFromParent: number
  readonly conflictedFiles?: number
  readonly skipReason?: string
  readonly willPush: boolean
}

export interface IForkSyncPreviewStats {
  readonly readyToMergeCount: number
  readonly conflictsCount: number
  readonly upToDateCount: number
  readonly skippedNoLocalCount: number
  readonly skippedDivergedOriginCount: number
  readonly syncableCount: number
}

export interface IForkSyncPreviewCache {
  readonly entries: ReadonlyArray<IForkSyncPreviewEntry>
  readonly stats: IForkSyncPreviewStats
  readonly lastFetched: Date | null
  readonly isLoading: boolean
  readonly isBasedOnFetch: boolean
}

export interface IForkSyncCompletedEntry {
  readonly branchName: string
  readonly status: 'synced' | 'up-to-date'
}

export interface IForkSyncStoppedEntry {
  readonly branchName: string
  readonly reason: string
}

export interface IForkSyncContext {
  readonly originalBranchName: string
  readonly remainingEntries: ReadonlyArray<IForkSyncPreviewEntry>
  readonly completedEntries: ReadonlyArray<IForkSyncCompletedEntry>
  readonly skippedEntries: ReadonlyArray<IForkSyncPreviewEntry>
  readonly autoPush: boolean
  readonly stoppedEntry?: IForkSyncStoppedEntry
}

export interface IForkSyncSummary {
  readonly syncedCount: number
  readonly upToDateCount: number
  readonly skippedCount: number
  readonly stoppedEntry?: IForkSyncStoppedEntry
}

export interface IForkSyncCandidateBranch {
  readonly branchName: string
  readonly localBranch: Branch | null
  readonly originBranch: Branch
  readonly upstreamBranch: Branch
}

function getForkSyncStatusSortOrder(status: ForkSyncBranchStatus) {
  switch (status) {
    case 'needs-sync':
      return 0
    case 'conflicts':
      return 1
    case 'up-to-date':
      return 2
    case 'skipped-diverged-origin':
      return 3
    case 'skipped-no-local':
      return 4
  }
}

export function sortForkSyncPreviewEntries(
  entries: ReadonlyArray<IForkSyncPreviewEntry>
): ReadonlyArray<IForkSyncPreviewEntry> {
  return [...entries].sort((a, b) => {
    const statusOrder =
      getForkSyncStatusSortOrder(a.status) -
      getForkSyncStatusSortOrder(b.status)

    if (statusOrder !== 0) {
      return statusOrder
    }

    return a.branchName.localeCompare(b.branchName)
  })
}

export function summarizeForkSyncPreviewEntries(
  entries: ReadonlyArray<IForkSyncPreviewEntry>
): IForkSyncPreviewStats {
  let readyToMergeCount = 0
  let conflictsCount = 0
  let upToDateCount = 0
  let skippedNoLocalCount = 0
  let skippedDivergedOriginCount = 0

  for (const entry of entries) {
    switch (entry.status) {
      case 'needs-sync':
        readyToMergeCount += 1
        break
      case 'conflicts':
        conflictsCount += 1
        break
      case 'up-to-date':
        upToDateCount += 1
        break
      case 'skipped-no-local':
        skippedNoLocalCount += 1
        break
      case 'skipped-diverged-origin':
        skippedDivergedOriginCount += 1
        break
    }
  }

  return {
    readyToMergeCount,
    conflictsCount,
    upToDateCount,
    skippedNoLocalCount,
    skippedDivergedOriginCount,
    syncableCount: readyToMergeCount + conflictsCount,
  }
}

export function getForkSyncCandidateBranches(
  branches: ReadonlyArray<Branch>,
  defaultBranchName: string | null,
  originRemoteName: string = 'origin',
  upstreamRemoteName: string = 'upstream'
): ReadonlyArray<IForkSyncCandidateBranch> {
  const localBranches = new Map<string, Branch>()
  const originBranches = new Map<string, Branch>()
  const upstreamBranches = new Map<string, Branch>()

  for (const branch of branches) {
    if (branch.type === BranchType.Local) {
      localBranches.set(branch.name, branch)
      continue
    }

    if (branch.remoteName === originRemoteName) {
      originBranches.set(branch.nameWithoutRemote, branch)
    } else if (branch.remoteName === upstreamRemoteName) {
      upstreamBranches.set(branch.nameWithoutRemote, branch)
    }
  }

  const branchNames = [...originBranches.keys()].filter(name =>
    upstreamBranches.has(name)
  )

  branchNames.sort((a, b) => {
    if (defaultBranchName !== null) {
      if (a === defaultBranchName && b !== defaultBranchName) {
        return -1
      }

      if (b === defaultBranchName && a !== defaultBranchName) {
        return 1
      }
    }

    return a.localeCompare(b)
  })

  return branchNames.map(branchName => ({
    branchName,
    localBranch: localBranches.get(branchName) ?? null,
    originBranch: originBranches.get(branchName)!,
    upstreamBranch: upstreamBranches.get(branchName)!,
  }))
}

export function buildForkSyncSummary(
  context: IForkSyncContext
): IForkSyncSummary {
  let syncedCount = 0
  let upToDateCount = 0

  for (const entry of context.completedEntries) {
    if (entry.status === 'synced') {
      syncedCount += 1
    } else {
      upToDateCount += 1
    }
  }

  return {
    syncedCount,
    upToDateCount,
    skippedCount: context.skippedEntries.length,
    stoppedEntry: context.stoppedEntry,
  }
}
