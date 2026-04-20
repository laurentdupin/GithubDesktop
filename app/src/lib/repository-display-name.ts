import * as Path from 'path'

import { CloningRepository } from '../models/cloning-repository'
import { Repository } from '../models/repository'

export type RepositoryDisplayTarget = Repository | CloningRepository

export const UnknownRepositoryBranchLabel = 'unknown'
export const DetachedRepositoryBranchLabel = 'detached'

export function getRepositoryDirectoryName(
  repository: RepositoryDisplayTarget
): string {
  const directoryName = Path.basename(repository.path)
  return directoryName.length > 0 ? directoryName : repository.path
}

export function getRepositoryBranchLabel(
  branchName: string | null | undefined
): string {
  return branchName ?? UnknownRepositoryBranchLabel
}

export function formatRepositoryDisplayName(
  repository: RepositoryDisplayTarget,
  branchName: string | null | undefined
): string {
  const segments = [getRepositoryNameLabel(repository)]
  const directoryName = getRepositoryDirectoryName(repository)

  if (!isRedundantDirectoryName(repository, directoryName)) {
    segments.push(directoryName)
  }

  segments.push(getRepositoryBranchLabel(branchName))
  return segments.join(' - ')
}

function getRepositoryNameLabel(repository: RepositoryDisplayTarget): string {
  if (repository instanceof Repository && repository.alias !== null) {
    return `${repository.alias} (${repository.name})`
  }

  return repository.name
}

function isRedundantDirectoryName(
  repository: RepositoryDisplayTarget,
  directoryName: string
) {
  return directoryName.toLowerCase() === repository.name.toLowerCase()
}
