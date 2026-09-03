import * as Path from 'path'

import { Repository } from '../../models/repository'
import {
  AppFileStatus,
  AppFileStatusKind,
  CommittedFileChange,
} from '../../models/status'
import { pathExists } from '../path-exists'
import { git } from './core'
import { NullTreeSHA } from './diff-index'
import { getChangedFilesBetween, IChangesetData } from './log'

function createSubmoduleRepository(path: string) {
  return new Repository(path, -1, null, false)
}

function prefixStatusPath(
  displaySubmodulePath: string,
  status: AppFileStatus
): AppFileStatus {
  if (
    status.kind !== AppFileStatusKind.Copied &&
    status.kind !== AppFileStatusKind.Renamed
  ) {
    return status
  }

  return {
    ...status,
    oldPath: Path.posix.join(displaySubmodulePath, status.oldPath),
  }
}

async function getGitlinkCommit(
  repository: Repository,
  commitish: string,
  path: string
): Promise<string | null> {
  const { stdout } = await git(
    ['ls-tree', commitish, '--', path],
    repository.path,
    'getHistoricalSubmoduleCommit'
  )
  const match = /^160000 commit ([0-9a-f]+)\t/.exec(stdout)
  return match?.[1] ?? null
}

async function hasCommit(repository: Repository, commitish: string) {
  const result = await git(
    ['cat-file', '-e', `${commitish}^{commit}`],
    repository.path,
    'hasHistoricalSubmoduleCommit',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  return result.exitCode === 0
}

async function expandSubmoduleChange(
  ownerRepository: Repository,
  file: CommittedFileChange,
  displaySubmodulePath: string,
  depth: number,
  visited: Set<string>
): Promise<IChangesetData> {
  try {
    const oldPath =
      file.status.kind === AppFileStatusKind.Copied ||
      file.status.kind === AppFileStatusKind.Renamed
        ? file.status.oldPath
        : file.path
    const oldCommit =
      file.status.kind === AppFileStatusKind.New
        ? null
        : await getGitlinkCommit(
            ownerRepository,
            file.parentCommitish,
            oldPath
          )
    const newCommit =
      file.status.kind === AppFileStatusKind.Deleted
        ? null
        : await getGitlinkCommit(ownerRepository, file.commitish, file.path)

    if (newCommit === null) {
      return { files: [], linesAdded: 0, linesDeleted: 0 }
    }

    const repositoryPath = Path.join(ownerRepository.path, file.path)
    if (!(await pathExists(Path.join(repositoryPath, '.git')))) {
      return { files: [], linesAdded: 0, linesDeleted: 0 }
    }

    const repository = createSubmoduleRepository(repositoryPath)
    if (
      !(await hasCommit(repository, newCommit)) ||
      (oldCommit !== null && !(await hasCommit(repository, oldCommit)))
    ) {
      return { files: [], linesAdded: 0, linesDeleted: 0 }
    }

    const resolvedPath = Path.resolve(repositoryPath)
    const normalizedPath = __WIN32__
      ? resolvedPath.toLowerCase()
      : resolvedPath
    const visitKey = `${normalizedPath}\0${oldCommit ?? NullTreeSHA}\0${newCommit}`
    if (visited.has(visitKey)) {
      return { files: [], linesAdded: 0, linesDeleted: 0 }
    }
    visited.add(visitKey)

    const changes = await getChangedFilesBetween(
      repository,
      oldCommit ?? NullTreeSHA,
      newCommit
    )
    const expandedFiles = new Array<CommittedFileChange>()
    let linesAdded = changes.linesAdded
    let linesDeleted = changes.linesDeleted

    for (const child of changes.files) {
      const displayPath = Path.posix.join(displaySubmodulePath, child.path)
      const expandedChild = new CommittedFileChange(
        displayPath,
        prefixStatusPath(displaySubmodulePath, child.status),
        child.commitish,
        child.parentCommitish,
        {
          repositoryPath,
          depth,
          pathInSubmodule: child.path,
          oldPathInSubmodule:
            child.status.kind === AppFileStatusKind.Copied ||
            child.status.kind === AppFileStatusKind.Renamed
              ? child.status.oldPath
              : undefined,
        }
      )
      expandedFiles.push(expandedChild)

      if (child.status.submoduleStatus !== undefined) {
        const descendants = await expandSubmoduleChange(
          repository,
          child,
          displayPath,
          depth + 1,
          visited
        )
        expandedFiles.push(...descendants.files)
        linesAdded += descendants.linesAdded
        linesDeleted += descendants.linesDeleted
      }
    }

    return { files: expandedFiles, linesAdded, linesDeleted }
  } catch (error) {
    log.warn(
      `[SubmoduleHistory] Unable to expand ${displaySubmodulePath}. Keeping the submodule pin row only.`,
      error
    )
    return { files: [], linesAdded: 0, linesDeleted: 0 }
  }
}

/** Add recursively changed submodule files beneath historical gitlink rows. */
export async function expandChangesetWithSubmoduleChanges(
  repository: Repository,
  changeset: IChangesetData
): Promise<IChangesetData> {
  const files = new Array<CommittedFileChange>()
  const visited = new Set<string>()
  let linesAdded = changeset.linesAdded
  let linesDeleted = changeset.linesDeleted

  for (const file of changeset.files) {
    files.push(file)
    if (file.status.submoduleStatus === undefined) {
      continue
    }

    const descendants = await expandSubmoduleChange(
      repository,
      file,
      file.path,
      1,
      visited
    )
    files.push(...descendants.files)
    linesAdded += descendants.linesAdded
    linesDeleted += descendants.linesDeleted
  }

  return { files, linesAdded, linesDeleted }
}

export function toSubmoduleCommittedChange(file: CommittedFileChange): {
  repository: Repository
  file: CommittedFileChange
} {
  const change = file.submoduleChange
  if (change === null) {
    throw new Error('Expected a committed submodule file change')
  }

  const status: AppFileStatus =
    file.status.kind === AppFileStatusKind.Copied ||
    file.status.kind === AppFileStatusKind.Renamed
      ? {
          ...file.status,
          oldPath: change.oldPathInSubmodule ?? file.status.oldPath,
        }
      : file.status

  return {
    repository: createSubmoduleRepository(change.repositoryPath),
    file: new CommittedFileChange(
      change.pathInSubmodule,
      status,
      file.commitish,
      file.parentCommitish,
      change
    ),
  }
}
