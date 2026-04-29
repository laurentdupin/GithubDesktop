import * as Path from 'path'
import * as os from 'os'
import { promises as fs } from 'fs'
import { GitError as DugiteError } from 'dugite'

import { Branch, BranchType } from '../../models/branch'
import { Repository } from '../../models/repository'
import {
  buildDesktopShelfBranchName,
  buildDesktopShelfCommitMessage,
  IShelf,
  isDesktopShelfBranchName,
  parseDesktopShelfMetadata,
} from '../../models/shelf'
import { getBranches } from './for-each-ref'
import { getCommit } from './log'
import { git, GitError } from './core'

interface IStashReference {
  readonly ref: string
  readonly sha: string
}

export interface ICreateShelfResult {
  readonly branchName: string
  readonly cleanupWarning: string | null
}

export type ApplyShelfResult = 'applied' | 'conflicts'

export function stashSubjectMatchesMessage(subject: string, message: string) {
  return subject === message || subject.endsWith(`: ${message}`)
}

export async function getShelves(
  repository: Repository
): Promise<ReadonlyArray<IShelf>> {
  const branches = await getBranches(repository)
  const shelfBranches = branches.filter(branch =>
    isDesktopShelfBranchName(branch.nameWithoutRemote)
  )

  if (shelfBranches.length === 0) {
    return []
  }

  const branchesByName = new Map<
    string,
    { local: Branch | null; remotes: Array<Branch> }
  >()

  for (const branch of shelfBranches) {
    const branchName = branch.nameWithoutRemote
    const existing = branchesByName.get(branchName) ?? {
      local: null,
      remotes: [],
    }

    if (branch.type === BranchType.Local) {
      existing.local = branch
    } else {
      existing.remotes.push(branch)
    }

    branchesByName.set(branchName, existing)
  }

  const shelves = new Array<IShelf>()

  for (const [branchName, refs] of branchesByName) {
    const remoteBranch =
      refs.local?.upstream != null
        ? refs.remotes.find(branch => branch.name === refs.local?.upstream) ??
          refs.remotes.find(branch => branch.remoteName === 'origin') ??
          refs.remotes[0] ??
          null
        : refs.remotes.find(branch => branch.remoteName === 'origin') ??
          refs.remotes[0] ??
          null

    const refToInspect = refs.local?.name ?? remoteBranch?.name
    if (refToInspect === undefined) {
      continue
    }

    const commit = await getCommit(repository, refToInspect)
    if (commit === null) {
      continue
    }

    const metadata = parseDesktopShelfMetadata(commit)
    shelves.push({
      id: branchName,
      name: metadata.name ?? branchName.replace(/^desktop-shelf\//, ''),
      branchName,
      localRef: refs.local?.name ?? null,
      remoteRef: remoteBranch?.name ?? refs.local?.upstream ?? null,
      remoteName: remoteBranch?.remoteName ?? refs.local?.upstreamRemoteName ?? null,
      sourceBranchName: metadata.sourceBranchName,
      sourceHeadSha: metadata.sourceHeadSha,
      createdAt: metadata.createdAt ?? commit.author.date,
      commitSha: commit.sha,
      commitSummary: commit.summary,
      isPublished: remoteBranch !== null || refs.local?.upstream != null,
      isRemoteOnly: refs.local === null,
    })
  }

  return shelves.toSorted((a, b) => {
    const aTime = a.createdAt?.getTime() ?? 0
    const bTime = b.createdAt?.getTime() ?? 0

    if (aTime !== bTime) {
      return bTime - aTime
    }

    return a.name.localeCompare(b.name)
  })
}

export async function createShelfBranchFromPaths(
  repository: Repository,
  currentBranch: Branch,
  selectedPaths: ReadonlyArray<string>,
  shelfName: string
): Promise<ICreateShelfResult> {
  if (selectedPaths.length === 0) {
    throw new Error('No files were selected to shelve.')
  }

  const now = new Date()
  const branchName = buildDesktopShelfBranchName(shelfName, now)
  const stashMessage = `DesktopShelf:${branchName}`
  const tempWorktreePath = Path.join(
    os.tmpdir(),
    `desktop-shelf-${crypto.randomUUID()}`
  )

  let stashRef: IStashReference | null = null
  let cleanupWarning: string | null = null
  let branchCreated = false
  let deleteCreatedBranch = false

  try {
    const stashArgs = [
      'stash',
      'push',
      '--include-untracked',
      '-m',
      stashMessage,
      '--',
      ...selectedPaths,
    ]

    const stashResult = await git(
      stashArgs,
      repository.path,
      'createShelfStash'
    ).catch(async error => {
      stashRef = await findStashReference(repository, stashMessage)

      if (stashRef === null) {
        throw error
      }

      cleanupWarning = getShelfCleanupWarning(error)
      log.warn(
        `Git created shelf stash ${stashRef.sha} but failed while removing the selected changes from ${repository.path}. Continuing shelf creation from the preserved stash.`,
        error
      )

      return null
    })

    if (stashResult?.stdout.trim() === 'No local changes to save') {
      throw new Error('There were no selected file changes to shelve.')
    }

    stashRef ??= await findStashReference(repository, stashMessage)
    if (stashRef === null) {
      throw new Error('Unable to locate the newly created shelf stash.')
    }

    await git(
      ['worktree', 'add', '--detach', tempWorktreePath, 'HEAD'],
      repository.path,
      'createShelfWorktree'
    )

    await git(
      ['checkout', '-b', branchName],
      tempWorktreePath,
      'createShelfBranch'
    )

    branchCreated = true

    await git(
      ['stash', 'apply', stashRef.sha],
      tempWorktreePath,
      'applyShelfStash'
    )

    await git(['add', '-A'], tempWorktreePath, 'stageShelfChanges')

    const commitMessage = buildDesktopShelfCommitMessage(
      shelfName,
      currentBranch.name,
      currentBranch.tip.sha,
      now
    )

    await git(
      ['commit', '--no-verify', '--allow-empty', '-F', '-'],
      tempWorktreePath,
      'commitShelfBranch',
      { stdin: commitMessage }
    )

    await dropStashReference(repository, stashRef.ref).catch(error =>
      log.warn('Failed to drop intermediate shelf stash after shelf creation', error)
    )
    stashRef = null

    return { branchName, cleanupWarning }
  } catch (error) {
    deleteCreatedBranch = branchCreated

    if (stashRef !== null) {
      if (cleanupWarning === null) {
        await restoreShelfStash(repository, stashRef).catch(restoreError => {
          log.error(
            `Failed to restore shelved changes after shelf creation error: ${error}`
          )
          log.error(restoreError)
        })
      } else {
        log.warn(
          `Leaving shelf stash ${stashRef.sha} in place after shelf creation failed because Git had already reported a cleanup problem.`
        )
      }
    }

    throw error
  } finally {
    await git(
      ['worktree', 'remove', '--force', tempWorktreePath],
      repository.path,
      'removeShelfWorktree',
      { successExitCodes: new Set([0, 128]) }
    ).catch(error => log.warn('Failed to remove temporary shelf worktree', error))

    if (deleteCreatedBranch) {
      await git(
        ['branch', '-D', branchName],
        repository.path,
        'deleteFailedShelfBranch',
        { successExitCodes: new Set([0, 1]) }
      ).catch(error => log.warn('Failed to delete incomplete shelf branch', error))
    }

    await fs.rm(tempWorktreePath, {
      recursive: true,
      force: true,
      maxRetries: 3,
    })
  }
}

function getShelfCleanupWarning(error: unknown) {
  const details =
    error instanceof GitError
      ? `${error.result.stderr}\n${error.result.stdout}`
      : error instanceof Error
        ? error.message
        : `${error}`

  if (/unable to unlink|permission denied|invalid argument/i.test(details)) {
    return [
      'The shelf was created, but Git could not remove at least one selected file from the current branch.',
      'This usually means a file is open or locked by another program. Close the program using the file, then verify or discard the remaining local changes after confirming the shelf exists.',
    ].join(' ')
  }

  return [
    'The shelf was created, but Git reported a problem while removing the selected changes from the current branch.',
    'Some shelved files may still appear as local changes until you clean them up manually.',
  ].join(' ')
}

export async function applyShelfToWorkingDirectory(
  repository: Repository,
  shelf: IShelf
): Promise<ApplyShelfResult> {
  const stashMessage = `DesktopUnshelve:${shelf.branchName}:${crypto.randomUUID()}`
  const tempWorktreePath = Path.join(
    os.tmpdir(),
    `desktop-unshelve-${crypto.randomUUID()}`
  )

  let stashRef: IStashReference | null = null

  try {
    await git(
      ['worktree', 'add', '--detach', tempWorktreePath, shelf.commitSha],
      repository.path,
      'createUnshelveWorktree'
    )

    await git(
      ['reset', '--mixed', 'HEAD^'],
      tempWorktreePath,
      'prepareShelfForUnshelve'
    )

    const stashResult = await git(
      ['stash', 'push', '--include-untracked', '-m', stashMessage],
      tempWorktreePath,
      'createUnshelveStash'
    )

    if (stashResult.stdout === 'No local changes to save\n') {
      return 'applied'
    }

    stashRef = await findStashReference(repository, stashMessage)
    if (stashRef === null) {
      throw new Error('Unable to locate the temporary unshelve stash.')
    }

    return applyUnshelveStash(repository, stashRef)
  } finally {
    if (stashRef !== null) {
      await dropStashReference(repository, stashRef.ref).catch(error =>
        log.warn('Failed to drop temporary unshelve stash', error)
      )
    }

    await git(
      ['worktree', 'remove', '--force', tempWorktreePath],
      repository.path,
      'removeUnshelveWorktree',
      { successExitCodes: new Set([0, 128]) }
    ).catch(error => log.warn('Failed to remove temporary unshelve worktree', error))

    await fs.rm(tempWorktreePath, {
      recursive: true,
      force: true,
      maxRetries: 3,
    })
  }
}

async function findStashReference(
  repository: Repository,
  message: string
): Promise<IStashReference | null> {
  const result = await git(
    ['log', '-g', '--format=%gd%x00%H%x00%gs', 'refs/stash'],
    repository.path,
    'findShelfStashReference',
    { successExitCodes: new Set([0, 128]) }
  )

  if (result.exitCode === 128) {
    return null
  }

  const entries = result.stdout.split('\n')
  for (const entry of entries) {
    if (entry.length === 0) {
      continue
    }

    const [ref, sha, subject] = entry.split('\0')
    if (stashSubjectMatchesMessage(subject, message)) {
      return { ref, sha }
    }
  }

  return null
}

async function dropStashReference(repository: Repository, ref: string) {
  await git(['stash', 'drop', ref], repository.path, 'dropShelfStash')
}

async function restoreShelfStash(
  repository: Repository,
  stashRef: IStashReference
) {
  await git(
    ['stash', 'pop', '--index', stashRef.ref],
    repository.path,
    'restoreShelfStash'
  )
}

async function applyUnshelveStash(
  repository: Repository,
  stashRef: IStashReference
): Promise<ApplyShelfResult> {
  try {
    await git(
      ['stash', 'apply', '--quiet', stashRef.sha],
      repository.path,
      'applyUnshelveStash'
    )

    return 'applied'
  } catch (error) {
    if (isUnshelveConflictError(error)) {
      return 'conflicts'
    }

    throw error
  }
}

function isUnshelveConflictError(error: unknown) {
  if (!(error instanceof GitError)) {
    return false
  }

  if (
    error.result.gitError === DugiteError.MergeConflicts ||
    error.result.gitError === DugiteError.PatchDoesNotApply
  ) {
    return true
  }

  const message = error.message.toUpperCase()
  return error.result.exitCode === 1 && message.includes('CONFLICT')
}
