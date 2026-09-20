export type SubmoduleUpdateStatus =
  | 'behind'
  | 'ahead'
  | 'diverged'
  | 'up-to-date'
  | 'dirty'
  | 'branch-required'
  | 'uninitialized'

export interface ISubmoduleUpdateEntry {
  readonly path: string
  readonly repositoryPath: string
  readonly depth: number
  readonly status: SubmoduleUpdateStatus
  readonly currentSha?: string
  readonly remoteSha?: string
  readonly remoteName?: string
  readonly branchName?: string
  readonly remoteRef?: string
  readonly ahead: number
  readonly behind: number
  readonly reason?: string
}

export interface ISubmoduleUpdateStats {
  readonly behindCount: number
  readonly aheadCount: number
  readonly divergedCount: number
  readonly upToDateCount: number
  readonly blockedCount: number
}

export interface ISubmoduleUpdatePreviewCache {
  readonly entries: ReadonlyArray<ISubmoduleUpdateEntry>
  readonly stats: ISubmoduleUpdateStats
  readonly isLoading: boolean
  readonly hasUnviewedResults: boolean
  readonly lastFetched: Date | null
}

export function summarizeSubmoduleUpdates(
  entries: ReadonlyArray<ISubmoduleUpdateEntry>
): ISubmoduleUpdateStats {
  return {
    behindCount: entries.filter(entry => entry.status === 'behind').length,
    aheadCount: entries.filter(entry => entry.status === 'ahead').length,
    divergedCount: entries.filter(entry => entry.status === 'diverged').length,
    upToDateCount: entries.filter(entry => entry.status === 'up-to-date')
      .length,
    blockedCount: entries.filter(
      entry =>
        entry.status === 'dirty' ||
        entry.status === 'branch-required' ||
        entry.status === 'uninitialized'
    ).length,
  }
}

export function sortSubmoduleUpdates(
  entries: ReadonlyArray<ISubmoduleUpdateEntry>
): ReadonlyArray<ISubmoduleUpdateEntry> {
  const order: Record<SubmoduleUpdateStatus, number> = {
    behind: 0,
    diverged: 1,
    dirty: 2,
    'branch-required': 3,
    ahead: 4,
    'up-to-date': 5,
    uninitialized: 6,
  }

  return [...entries].sort(
    (a, b) => order[a.status] - order[b.status] || a.path.localeCompare(b.path)
  )
}
