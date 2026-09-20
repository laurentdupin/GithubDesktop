import { git, IGitStringExecutionOptions } from './core'
import { Repository } from '../../models/repository'
import { Branch, BranchType } from '../../models/branch'
import { clampProgress, ICheckoutProgress } from '../../models/progress'
import {
  CheckoutProgressParser,
  executionOptionsWithProgress,
} from '../progress'
import { AuthenticationErrors } from './authentication'
import {
  envForRemoteOperation,
  getFallbackUrlForProxyResolve,
} from './environment'
import { WorkingDirectoryFileChange } from '../../models/status'
import { ManualConflictResolution } from '../../models/manual-conflict-resolution'
import { CommitOneLine, shortenSHA } from '../../models/commit'
import { IRemote } from '../../models/remote'
import { updateSubmodulesAfterOperation } from './submodule'

export type ProgressCallback = (progress: ICheckoutProgress) => void

const CheckoutStepWeight = 0.9

function getCheckoutArgs(progressCallback?: ProgressCallback) {
  return ['checkout', ...(progressCallback ? ['--progress'] : [])]
}

interface IRawTreeChange {
  readonly oldMode: string
  readonly newMode: string
  readonly path: string
}

async function getSubmodulesReplacedByFiles(
  repository: Repository,
  target: string
): Promise<ReadonlyArray<string>> {
  const resolvedTarget = await git(
    ['rev-parse', '--verify', `${target}^{commit}`],
    repository.path,
    'resolveSubmoduleCheckoutTarget',
    { successExitCodes: new Set([0, 1, 128]) }
  )

  // Leave invalid-reference reporting to checkout so callers receive the same
  // error they did before this preparation step was added.
  if (resolvedTarget.exitCode !== 0) {
    return []
  }

  const { stdout } = await git(
    [
      'diff',
      '--raw',
      '-z',
      '--no-renames',
      '--diff-filter=DT',
      'HEAD',
      target,
      '--',
    ],
    repository.path,
    'getSubmodulesReplacedByFiles'
  )
  const fields = stdout.split('\0')
  const changes = new Array<IRawTreeChange>()

  for (let i = 0; i + 1 < fields.length; i += 2) {
    const match = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ [A-Z]$/.exec(fields[i])

    if (match !== null) {
      changes.push({
        oldMode: match[1],
        newMode: match[2],
        path: fields[i + 1],
      })
    }
  }

  const changedSubmodules = changes.filter(
    change => change.oldMode === '160000' && change.newMode !== '160000'
  )

  const replaced = await Promise.all(
    changedSubmodules.map(async change => {
      if (change.newMode !== '000000') {
        return change.path
      }

      const targetEntry = await git(
        ['ls-tree', '-z', target, '--', change.path],
        repository.path,
        'getSubmoduleReplacementTarget'
      )

      return targetEntry.stdout.length > 0 ? change.path : null
    })
  )

  return replaced.filter((path): path is string => path !== null)
}

async function restoreDeinitializedSubmodules(
  repository: Repository,
  paths: ReadonlyArray<string>,
  opts: IGitStringExecutionOptions,
  allowFileProtocol: boolean
) {
  if (paths.length === 0) {
    return
  }

  const args = [
    ...(allowFileProtocol ? ['-c', 'protocol.file.allow=always'] : []),
    'submodule',
    'update',
    '--init',
    '--recursive',
    '--',
    ...paths,
  ]

  await git(args, repository.path, 'restoreDeinitializedSubmodules', opts)
}

async function deinitializeSubmodulesReplacedByFiles(
  repository: Repository,
  target: string,
  opts: IGitStringExecutionOptions,
  allowFileProtocol: boolean
) {
  const paths = await getSubmodulesReplacedByFiles(repository, target)
  const deinitialized = new Array<string>()

  try {
    for (const path of paths) {
      // Deliberately omit --force so Git refuses to remove a dirty submodule.
      await git(
        ['submodule', 'deinit', '--', path],
        repository.path,
        'deinitializeReplacedSubmodule',
        opts
      )
      deinitialized.push(path)
    }
  } catch (error) {
    await restoreDeinitializedSubmodules(
      repository,
      deinitialized,
      opts,
      allowFileProtocol
    ).catch(restoreError =>
      log.warn(
        'Failed to restore submodules after checkout preparation',
        restoreError
      )
    )
    throw error
  }

  return deinitialized
}

async function getBranchCheckoutArgs(branch: Branch) {
  return [
    branch.name,
    ...(branch.type === BranchType.Remote
      ? ['-b', branch.nameWithoutRemote]
      : []),
    '--',
  ]
}

async function getCheckoutOpts(
  repository: Repository,
  title: string,
  target: string,
  currentRemote: IRemote | null,
  progressCallback?: ProgressCallback,
  initialDescription?: string
): Promise<IGitStringExecutionOptions> {
  const opts: IGitStringExecutionOptions = {
    env: await envForRemoteOperation(
      getFallbackUrlForProxyResolve(repository, currentRemote)
    ),
    expectedErrors: AuthenticationErrors,
  }

  if (!progressCallback) {
    return opts
  }

  const kind = 'checkout'

  // Initial progress
  progressCallback({
    kind,
    title,
    description: initialDescription ?? title,
    value: 0,
    target,
  })

  return await executionOptionsWithProgress(
    { ...opts, trackLFSProgress: true },
    new CheckoutProgressParser(),
    progress => {
      if (progress.kind === 'progress') {
        const description = progress.details.text
        const value = progress.percent

        progressCallback({
          kind,
          title,
          description,
          value,
          target,
        })
      }
    }
  )
}

/**
 * Check out the given branch.
 *
 * @param repository - The repository in which the branch checkout should
 *                     take place
 *
 * @param branch     - The branch name that should be checked out
 *
 * @param progressCallback - An optional function which will be invoked
 *                           with information about the current progress
 *                           of the checkout operation. When provided this
 *                           enables the '--progress' command line flag for
 *                           'git checkout'.
 */
export async function checkoutBranch(
  repository: Repository,
  branch: Branch,
  currentRemote: IRemote | null,
  progressCallback?: ProgressCallback,
  allowFileProtocol: boolean = false
): Promise<true> {
  const title = `Checking out branch ${branch.name}`
  const opts = await getCheckoutOpts(
    repository,
    title,
    branch.name,
    currentRemote,
    progressCallback
      ? clampProgress(0, CheckoutStepWeight, progressCallback)
      : undefined,
    `Switching to ${__DARWIN__ ? 'Branch' : 'branch'}`
  )

  const baseArgs = getCheckoutArgs(progressCallback)
  const args = [...baseArgs, ...(await getBranchCheckoutArgs(branch))]
  const deinitializedSubmodules = await deinitializeSubmodulesReplacedByFiles(
    repository,
    branch.name,
    opts,
    allowFileProtocol
  )

  try {
    await git(args, repository.path, 'checkoutBranch', opts)
  } catch (error) {
    await restoreDeinitializedSubmodules(
      repository,
      deinitializedSubmodules,
      opts,
      allowFileProtocol
    ).catch(restoreError =>
      log.warn(
        'Failed to restore submodules after checkout failure',
        restoreError
      )
    )
    throw error
  }

  // Update submodules after checkout
  await updateSubmodulesAfterOperation(
    repository,
    currentRemote,
    progressCallback
      ? clampProgress<ICheckoutProgress>(
          CheckoutStepWeight,
          1,
          progressCallback
        )
      : undefined,
    'checkout',
    title,
    branch.name,
    allowFileProtocol
  )

  // we return `true` here so `GitStore.performFailableGitOperation`
  // will return _something_ differentiable from `undefined` if this succeeds
  return true
}

/**
 * Check out the given commit.
 * Literally invokes `git checkout <commit SHA>`.
 *
 * @param repository - The repository in which the branch checkout should
 *                     take place
 *
 * @param commit     - The commit that should be checked out
 *
 * @param progressCallback - An optional function which will be invoked
 *                           with information about the current progress
 *                           of the checkout operation. When provided this
 *                           enables the '--progress' command line flag for
 *                           'git checkout'.
 */
export async function checkoutCommit(
  repository: Repository,
  commit: CommitOneLine,
  currentRemote: IRemote | null,
  progressCallback?: ProgressCallback,
  allowFileProtocol: boolean = false
): Promise<true> {
  const title = `Checking out ${__DARWIN__ ? 'Commit' : 'commit'}`
  const target = shortenSHA(commit.sha)
  const opts = await getCheckoutOpts(
    repository,
    title,
    target,
    currentRemote,
    progressCallback
      ? clampProgress(0, CheckoutStepWeight, progressCallback)
      : undefined
  )

  const baseArgs = getCheckoutArgs(progressCallback)
  const args = [...baseArgs, commit.sha]

  await git(args, repository.path, 'checkoutCommit', opts)

  // Update submodules after checkout
  await updateSubmodulesAfterOperation(
    repository,
    currentRemote,
    progressCallback
      ? clampProgress<ICheckoutProgress>(
          CheckoutStepWeight,
          1,
          progressCallback
        )
      : undefined,
    'checkout',
    title,
    target,
    allowFileProtocol
  )

  // we return `true` here so `GitStore.performFailableGitOperation`
  // will return _something_ differentiable from `undefined` if this succeeds
  return true
}

/** Check out the paths at HEAD. */
export async function checkoutPaths(
  repository: Repository,
  paths: ReadonlyArray<string>
): Promise<void> {
  await git(
    ['checkout', 'HEAD', '--', ...paths],
    repository.path,
    'checkoutPaths'
  )
}

/**
 * Check out either stage #2 (ours) or #3 (theirs) for a conflicted
 * file.
 */
export async function checkoutConflictedFile(
  repository: Repository,
  file: WorkingDirectoryFileChange,
  resolution: ManualConflictResolution
) {
  await git(
    ['checkout', `--${resolution}`, '--', file.path],
    repository.path,
    'checkoutConflictedFile'
  )
}
