import * as Path from 'path'

import { DiffSelection, DiffSelectionType } from '../../models/diff'
import { Repository } from '../../models/repository'
import {
  AppFileStatus,
  AppFileStatusKind,
  WorkingDirectoryFileChange,
  isSyntheticSubmoduleChange,
} from '../../models/status'
import { pathExists } from '../path-exists'
import { getStatus } from './status'

function buildSyntheticSubmoduleStatus(
  submodulePath: string,
  file: WorkingDirectoryFileChange
): AppFileStatus {
  const prefixedPath = (path: string) => Path.posix.join(submodulePath, path)

  switch (file.status.kind) {
    case AppFileStatusKind.Copied:
    case AppFileStatusKind.Renamed:
      return {
        ...file.status,
        oldPath: prefixedPath(file.status.oldPath),
      }
    default:
      return file.status
  }
}

function createSyntheticSubmoduleChange(
  parentSubmodulePath: string,
  submoduleRepositoryPath: string,
  file: WorkingDirectoryFileChange
) {
  return new WorkingDirectoryFileChange(
    Path.posix.join(parentSubmodulePath, file.path),
    buildSyntheticSubmoduleStatus(parentSubmodulePath, file),
    DiffSelection.fromInitialSelection(DiffSelectionType.None),
    {
      submodulePath: parentSubmodulePath,
      submoduleRepositoryPath,
      pathInSubmodule: file.path,
      oldPathInSubmodule:
        file.status.kind === AppFileStatusKind.Copied ||
        file.status.kind === AppFileStatusKind.Renamed
          ? file.status.oldPath
          : undefined,
    }
  )
}

function createSubmoduleRepository(path: string) {
  return new Repository(path, -1, null, false)
}

export async function getSubmoduleRepositoryWorkingDirectory(
  parentRepository: Repository,
  submodulePath: string
): Promise<{
  repository: Repository
  files: ReadonlyArray<WorkingDirectoryFileChange>
} | null> {
  const submoduleRepositoryPath = Path.join(parentRepository.path, submodulePath)

  if (!(await pathExists(Path.join(submoduleRepositoryPath, '.git')))) {
    return null
  }

  const submoduleRepository = createSubmoduleRepository(submoduleRepositoryPath)
  const status = await getStatus(submoduleRepository)

  if (status === null || status.workingDirectory.files.length === 0) {
    return null
  }

  return {
    repository: submoduleRepository,
    files: status.workingDirectory.files,
  }
}

export async function getSubmoduleWorkingDirectoryFiles(
  parentRepository: Repository,
  submodulePath: string
): Promise<ReadonlyArray<WorkingDirectoryFileChange>> {
  const submoduleWorkingDirectory = await getSubmoduleRepositoryWorkingDirectory(
    parentRepository,
    submodulePath
  )

  if (submoduleWorkingDirectory === null) {
    return []
  }

  return submoduleWorkingDirectory.files.map(file =>
    createSyntheticSubmoduleChange(
      submodulePath,
      submoduleWorkingDirectory.repository.path,
      file
    )
  )
}

export async function expandWorkingDirectoryWithSubmoduleChanges(
  repository: Repository,
  files: ReadonlyArray<WorkingDirectoryFileChange>
): Promise<ReadonlyArray<WorkingDirectoryFileChange>> {
  const expanded = await Promise.all(
    files.map(async file => {
      if (
        file.status.submoduleStatus === undefined ||
        (!file.status.submoduleStatus.modifiedChanges &&
          !file.status.submoduleStatus.untrackedChanges)
      ) {
        return [file]
      }

      const submoduleFiles = await getSubmoduleWorkingDirectoryFiles(
        repository,
        file.path
      )

      return [file, ...submoduleFiles]
    })
  )

  return expanded.flat()
}

export function toSubmoduleRepositoryChange(
  file: WorkingDirectoryFileChange
): { repository: Repository; file: WorkingDirectoryFileChange } {
  if (!isSyntheticSubmoduleChange(file)) {
    throw new Error('Expected a synthetic submodule change')
  }

  const repository = createSubmoduleRepository(
    file.submoduleChange.submoduleRepositoryPath
  )

  const status: AppFileStatus =
    file.status.kind === AppFileStatusKind.Copied ||
    file.status.kind === AppFileStatusKind.Renamed
      ? {
          ...file.status,
          oldPath: file.submoduleChange.oldPathInSubmodule ?? file.status.oldPath,
        }
      : file.status

  return {
    repository,
    file: new WorkingDirectoryFileChange(
      file.submoduleChange.pathInSubmodule,
      status,
      file.selection
    ),
  }
}
