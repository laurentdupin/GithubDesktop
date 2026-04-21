import { Branch } from '../../models/branch'
import { getDesktopShelfDisplayName, IShelf } from '../../models/shelf'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'

export type BranchGroupIdentifier = 'default' | 'recent' | 'shelves' | 'other'

export interface IBranchListItem extends IFilterListItem {
  readonly text: ReadonlyArray<string>
  readonly id: string
  readonly branch: Branch
  readonly displayName: string
}

export function groupBranches(
  defaultBranch: Branch | null,
  currentBranch: Branch | null,
  allBranches: ReadonlyArray<Branch>,
  recentBranches: ReadonlyArray<Branch>,
  shelfBranches: ReadonlyArray<Branch>,
  shelves: ReadonlyArray<IShelf>
): ReadonlyArray<IFilterListGroup<IBranchListItem>> {
  const groups = new Array<IFilterListGroup<IBranchListItem>>()
  const activeShelvesByName = new Map(
    shelves.map(shelf => [shelf.branchName, shelf] as const)
  )
  const activeShelfBranchNames = new Set(activeShelvesByName.keys())

  if (defaultBranch) {
    groups.push({
      identifier: 'default',
      items: [
        {
          text: [defaultBranch.name],
          id: defaultBranch.name,
          branch: defaultBranch,
          displayName: defaultBranch.name,
        },
      ],
    })
  }

  const recentBranchNames = new Set<string>()
  const defaultBranchName = defaultBranch ? defaultBranch.name : null
  const recentBranchesWithoutDefault = recentBranches.filter(
    b =>
      b.name !== defaultBranchName &&
      !activeShelfBranchNames.has(b.nameWithoutRemote)
  )
  if (recentBranchesWithoutDefault.length > 0) {
    const recentBranches = new Array<IBranchListItem>()

    for (const branch of recentBranchesWithoutDefault) {
      recentBranches.push({
        text: [branch.name],
        id: branch.name,
        branch,
        displayName: branch.name,
      })
      recentBranchNames.add(branch.name)
    }

    groups.push({
      identifier: 'recent',
      items: recentBranches,
    })
  }

  const activeShelfBranches = shelfBranches.filter(
    branch => activeShelfBranchNames.has(branch.nameWithoutRemote)
  )

  if (activeShelfBranches.length > 0) {
    groups.push({
      identifier: 'shelves',
      items: activeShelfBranches.map(branch => {
        const shelf = activeShelvesByName.get(branch.nameWithoutRemote)
        const displayName =
          shelf?.name ?? getDesktopShelfDisplayName(branch.nameWithoutRemote)

        return {
          text: [displayName],
          id: branch.name,
          branch,
          displayName,
        }
      }),
    })
  }

  const remainingBranches = [...allBranches, ...shelfBranches].filter(
    b =>
      b.name !== defaultBranchName &&
      !recentBranchNames.has(b.name) &&
      !activeShelfBranchNames.has(b.nameWithoutRemote) &&
      !b.isDesktopForkRemoteBranch
  )

  const remainingItems = remainingBranches.map(b => ({
    text: [b.name],
    id: b.name,
    branch: b,
    displayName: b.name,
  }))
  groups.push({
    identifier: 'other',
    items: remainingItems,
  })

  return groups
}
