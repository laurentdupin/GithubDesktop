import {
  Repository,
  ILocalRepositoryState,
  nameOf,
} from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { caseInsensitiveCompare } from '../../lib/compare'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'
import { IAheadBehind } from '../../models/branch'
import { formatRepositoryDisplayName } from '../../lib/repository-display-name'

export type RepositoryListGroup = 'all'

/**
 * Returns a unique grouping key (string) for a repository group. Doubles as a
 * case sensitive sorting key (i.e the case sensitive sort order of the keys is
 * the order in which the groups will be displayed in the repository list).
 */
export const getGroupKey = (group: RepositoryListGroup) => {
  return group
}
export type Repositoryish = Repository | CloningRepository

export interface IRepositoryListItem extends IFilterListItem {
  readonly text: ReadonlyArray<string>
  readonly id: string
  readonly repository: Repositoryish
  readonly needsDisambiguation: boolean
  readonly aheadBehind: IAheadBehind | null
  readonly currentBranch: string | null
  readonly changedFilesCount: number
}

export function groupRepositories(
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  _recentRepositories: ReadonlyArray<number>
): ReadonlyArray<IFilterListGroup<IRepositoryListItem, RepositoryListGroup>> {
  return [
    {
      identifier: 'all',
      items: toSortedListItems(repositories, localRepositoryStateLookup),
    },
  ]
}

const getDisplayTitle = (r: Repositoryish) => r.name

const toSortedListItems = (
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>
): IRepositoryListItem[] => {
  const allNames = new Map<string, number>()

  for (const title of repositories.map(getDisplayTitle)) {
    allNames.set(title, (allNames.get(title) ?? 0) + 1)
  }

  return repositories
    .map(r => {
      const repoState = localRepositoryStateLookup.get(r.id)
      const title = getDisplayTitle(r)
      const subtitle =
        r instanceof Repository
          ? [nameOf(r), r.alias]
              .filter((value): value is string => !!value)
              .join(' ')
          : ''

      return {
        text:
          subtitle.length > 0
            ? [formatRepositoryDisplayName(r, repoState?.currentBranch), subtitle]
            : [formatRepositoryDisplayName(r, repoState?.currentBranch)],
        id: r.id.toString(),
        repository: r,
        needsDisambiguation: (allNames.get(title) ?? 0) > 1,
        aheadBehind: repoState?.aheadBehind ?? null,
        currentBranch: repoState?.currentBranch ?? null,
        changedFilesCount: repoState?.changedFilesCount ?? 0,
      }
    })
    .sort(({ repository: x }, { repository: y }) =>
      caseInsensitiveCompare(getDisplayTitle(x), getDisplayTitle(y))
    )
}
