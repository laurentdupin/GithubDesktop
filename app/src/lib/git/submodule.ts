import { join, resolve } from 'path'
import { readFile } from 'fs/promises'
import { git, IGitStringExecutionOptions } from './core'
import { Repository } from '../../models/repository'
import { SubmoduleEntry } from '../../models/submodule'
import { pathExists } from '../path-exists'
import { executionOptionsWithProgress, IGitOutput } from '../progress'
import {
  envForRemoteOperation,
  getFallbackUrlForProxyResolve,
} from './environment'
import { AuthenticationErrors } from './authentication'
import { IRemote } from '../../models/remote'
import { Progress } from '../../models/progress'
import { getStatus } from './status'
import { getRemotes } from './remote'

export type SubmodulePushContext = {
  readonly path: string
  readonly repository: Repository
  readonly remote: IRemote
  readonly branchName: string
  readonly remoteBranchName: string | null
}

function findDefaultRemote(remotes: ReadonlyArray<IRemote>): IRemote | null {
  return remotes.find(r => r.name === 'origin') || remotes[0] || null
}

function parseUpstreamRef(
  upstreamRef: string
): { remoteName: string; branchName: string } | null {
  const separatorIndex = upstreamRef.indexOf('/')
  if (separatorIndex === -1) {
    return null
  }

  return {
    remoteName: upstreamRef.slice(0, separatorIndex),
    branchName: upstreamRef.slice(separatorIndex + 1),
  }
}

function createSubmoduleRepository(path: string) {
  return new Repository(path, -1, null, false)
}

type SubmoduleBranchPublishStrategy =
  | 'available'
  | 'push'
  | 'remote-ahead'
  | 'diverged'

type SubmoduleBranchPublishComparison = {
  readonly strategy: SubmoduleBranchPublishStrategy
  readonly remoteTip?: string
}

async function getSubmoduleBranchPublishStrategy(
  repository: Repository,
  remote: IRemote,
  branchName: string,
  commitSha: string
): Promise<SubmoduleBranchPublishComparison> {
  const remoteBranchRef = `refs/heads/${branchName}`
  const { stdout: advertisedBranch } = await git(
    ['ls-remote', '--heads', remote.name, remoteBranchRef],
    repository.path,
    'getRemoteSubmoduleBranchTip',
    {
      env: await envForRemoteOperation(remote.url),
      expectedErrors: AuthenticationErrors,
    }
  )
  const advertisedSha = advertisedBranch.split('\t')[0]
  if (advertisedSha.length === 0) {
    return { strategy: 'push' }
  }

  const objectCheck = await git(
    ['cat-file', '-e', `${advertisedSha}^{commit}`],
    repository.path,
    'verifyRemoteSubmoduleBranchTip',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  if (objectCheck.exitCode !== 0) {
    await git(
      [
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        remote.name,
        remoteBranchRef,
      ],
      repository.path,
      'fetchRemoteSubmoduleBranchTip',
      {
        env: await envForRemoteOperation(remote.url),
        expectedErrors: AuthenticationErrors,
      }
    )
  }

  const localIsPublished = await git(
    ['merge-base', '--is-ancestor', commitSha, advertisedSha],
    repository.path,
    'verifySubmoduleCommitOnRemoteBranch',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  if (localIsPublished.exitCode === 0) {
    return {
      strategy: commitSha === advertisedSha ? 'available' : 'remote-ahead',
      remoteTip: advertisedSha,
    }
  }

  const branchCanFastForward = await git(
    ['merge-base', '--is-ancestor', advertisedSha, commitSha],
    repository.path,
    'verifySubmoduleBranchCanFastForward',
    { successExitCodes: new Set([0, 1, 128]) }
  )
  return {
    strategy: branchCanFastForward.exitCode === 0 ? 'push' : 'diverged',
    remoteTip: advertisedSha,
  }
}

async function getConfiguredSubmoduleBranches(repository: Repository) {
  const branches = new Map<string, string>()
  if (!(await pathExists(join(repository.path, '.gitmodules')))) {
    return branches
  }

  const { stdout: paths } = await git(
    [
      'config',
      '--file',
      '.gitmodules',
      '--get-regexp',
      '^submodule\\..*\\.path$',
    ],
    repository.path,
    'getSubmodulePathsForPush',
    { successExitCodes: new Set([0, 1]) }
  )
  const { stdout: configuredBranches } = await git(
    [
      'config',
      '--file',
      '.gitmodules',
      '--get-regexp',
      '^submodule\\..*\\.branch$',
    ],
    repository.path,
    'getSubmoduleBranchesForPush',
    { successExitCodes: new Set([0, 1]) }
  )
  const pathsByName = new Map<string, string>()

  for (const line of paths.split('\n')) {
    const match = /^submodule\.(.+)\.path (.+)$/.exec(line.trim())
    if (match !== null) {
      pathsByName.set(match[1], match[2])
    }
  }

  for (const line of configuredBranches.split('\n')) {
    const match = /^submodule\.(.+)\.branch (.+)$/.exec(line.trim())
    const path = match === null ? undefined : pathsByName.get(match[1])
    if (match !== null && path !== undefined) {
      branches.set(path, match[2])
    }
  }

  return branches
}

async function getRemoteDefaultBranch(
  repository: Repository,
  remote: IRemote
): Promise<string | undefined> {
  const { stdout } = await git(
    ['ls-remote', '--symref', remote.name, 'HEAD'],
    repository.path,
    'getRemoteSubmoduleDefaultBranch',
    {
      env: await envForRemoteOperation(remote.url),
      expectedErrors: AuthenticationErrors,
    }
  )

  const match = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(stdout)
  return match?.[1]
}

async function resolveCommit(repository: Repository, ref: string) {
  const { stdout, exitCode } = await git(
    ['rev-parse', '--verify', `${ref}^{commit}`],
    repository.path,
    'resolveSubmodulePushBaseline',
    { successExitCodes: new Set([0, 128]) }
  )

  return exitCode === 0 ? stdout.trim() : undefined
}

/**
 * Update submodules after a git operation.
 *
 * @param repository - The repository in which to update submodules
 * @param remote - The remote for environment setup (can be null)
 * @param progressCallback - An optional function which will be invoked
 *                           with information about the current progress
 *                           of the submodule update operation.
 * @param progressKind - The kind of progress event ('checkout', 'pull', etc.)
 * @param title - The title to use for progress reporting
 * @param targetOrRemote - The target (for checkout) or remote name (for pull)
 * @param allowFileProtocol - Whether to allow file:// protocol for submodules
 */
export async function updateSubmodulesAfterOperation<T extends Progress>(
  repository: Repository,
  remote: IRemote | null,
  progressCallback: ((progress: T) => void) | undefined,
  progressKind: T['kind'],
  title: string,
  targetOrRemote: string,
  allowFileProtocol: boolean
): Promise<void> {
  const opts: IGitStringExecutionOptions = {
    env: await envForRemoteOperation(
      getFallbackUrlForProxyResolve(repository, remote)
    ),
    expectedErrors: AuthenticationErrors,
  }

  const args = [
    ...(allowFileProtocol ? ['-c', 'protocol.file.allow=always'] : []),
    'submodule',
    'update',
    '--init',
    '--recursive',
  ]

  if (!progressCallback) {
    await git(args, repository.path, 'updateSubmodules', opts)
    return
  }

  // Initial progress
  progressCallback({
    kind: progressKind,
    title,
    description: 'Updating submodules',
    value: 0,
    // Add the target or remote field based on the progress kind
    ...(progressKind === 'checkout'
      ? { target: targetOrRemote }
      : { remote: targetOrRemote }),
  } as T)

  let submoduleEventCount = 0

  const progressOpts = await executionOptionsWithProgress(
    { ...opts, trackLFSProgress: true },
    {
      parse(line: string): IGitOutput {
        if (
          line.match(/^Submodule path (.)+?: checked out /) ||
          line.startsWith('Cloning into ')
        ) {
          submoduleEventCount += 1
        }

        return {
          kind: 'context',
          text: `Updating submodules: ${line}`,
          // Math taken from https://math.stackexchange.com/a/2323106
          // We do this to fake a progress that slows down as we process more
          // events, as we don't know how many submodules there are upfront, or
          // what does git have to do with them (cloning, just checking them
          // out...)
          percent: 1 - Math.exp(-submoduleEventCount * 0.25),
        }
      },
    },
    progress => {
      const description =
        progress.kind === 'progress' ? progress.details.text : progress.text

      const value = progress.percent

      progressCallback({
        kind: progressKind,
        title,
        description,
        value,
        ...(progressKind === 'checkout'
          ? { target: targetOrRemote }
          : { remote: targetOrRemote }),
      } as T)
    }
  )

  await git(args, repository.path, 'updateSubmodules', progressOpts)

  // Final progress
  progressCallback({
    kind: progressKind,
    title,
    description: 'Submodules updated',
    value: 1,
    ...(progressKind === 'checkout'
      ? { target: targetOrRemote }
      : { remote: targetOrRemote }),
  } as T)
}

export async function listSubmodules(
  repository: Repository
): Promise<ReadonlyArray<SubmoduleEntry>> {
  const [submodulesFile, submodulesDir] = await Promise.all([
    pathExists(join(repository.path, '.gitmodules')),
    pathExists(join(repository.path, '.git', 'modules')),
  ])

  if (!submodulesFile && !submodulesDir) {
    // repo path + .gitmodules and + .git/modules covers the vast majority of
    // "normal" repositories but if we're in a linked worktree the modules
    // directory is actually in the git common dir so we'll also check for the
    // existence of the modules directory there as well before giving up on the
    // existence of submodules in this repo. We're reading the commondir file
    // ourselves here instead of calling out to git to avoid the cost of
    // spawning a process on Windows
    const commonDirPath = join(repository.resolvedGitDir, 'commondir')
    const commonDir = await readFile(commonDirPath, 'utf8')
      .then(content => content.replace(/\r?\n$/, ''))
      .then(p => (p ? resolve(repository.resolvedGitDir, p) : null))
      .catch(() => null)

    if (!commonDir || !(await pathExists(join(commonDir, 'modules')))) {
      log.info('No submodules found. Skipping "git submodule status"')
      return []
    }
  }

  // We don't recurse when listing submodules here because we don't have a good
  // story about managing these currently. So for now we're only listing
  // changes to the top-level submodules to be consistent with `git status`
  const { stdout, exitCode } = await git(
    ['submodule', 'status', '--'],
    repository.path,
    'listSubmodules',
    { successExitCodes: new Set([0, 128]) }
  )

  if (exitCode === 128) {
    // unable to parse submodules in repository, giving up
    return []
  }

  const submodules = new Array<SubmoduleEntry>()

  // entries are of the format:
  //  1eaabe34fc6f486367a176207420378f587d3b48 git (v2.16.0-rc0)
  //
  // first character:
  //   - " " if no change
  //   - "-" if the submodule is not initialized
  //   - "+" if the currently checked out submodule commit does not match the SHA-1 found in the index of the containing repository
  //   - "U" if the submodule has merge conflicts
  //
  // then the 40-character SHA represents the current commit
  //
  // then the path to the submodule
  //
  // then the output of `git describe` for the submodule in braces
  // we're not leveraging this in the app, so go and read the docs
  // about it if you want to learn more:
  //
  // https://git-scm.com/docs/git-describe
  const statusRe = /^.([^ ]+) (.+) \((.+?)\)$/gm

  for (const [, sha, path, describe] of stdout.matchAll(statusRe)) {
    submodules.push(new SubmoduleEntry(sha, path, describe))
  }

  return submodules
}

export async function getSubmodulesToPush(
  repository: Repository,
  candidatePaths?: ReadonlySet<string>,
  commitSha?: string
): Promise<ReadonlyArray<SubmodulePushContext>> {
  if (candidatePaths !== undefined && candidatePaths.size === 0) {
    return []
  }

  const pushableSubmodules = new Array<SubmodulePushContext>()
  const visitedRepositoryPaths = new Set<string>([
    normalizeSubmoduleRepositoryPath(repository.path),
  ])
  const rootStatus = await getStatus(repository)
  const baselineCommitSha =
    commitSha !== undefined && rootStatus?.currentUpstreamBranch !== undefined
      ? await resolveCommit(repository, rootStatus.currentUpstreamBranch)
      : undefined

  await collectSubmodulesToPush(
    repository,
    '',
    candidatePaths,
    visitedRepositoryPaths,
    pushableSubmodules,
    commitSha,
    rootStatus?.currentBranch,
    baselineCommitSha
  )

  return pushableSubmodules
}

function normalizeSubmoduleRepositoryPath(path: string) {
  const normalizedPath = resolve(path)
  return __WIN32__ ? normalizedPath.toLowerCase() : normalizedPath
}

async function collectSubmodulesToPush(
  repository: Repository,
  parentPath: string,
  candidatePaths: ReadonlySet<string> | undefined,
  visitedRepositoryPaths: Set<string>,
  pushableSubmodules: Array<SubmodulePushContext>,
  commitSha?: string,
  repositoryBranchName?: string,
  baselineCommitSha?: string
): Promise<void> {
  const submodules =
    commitSha === undefined
      ? await listSubmodules(repository)
      : await listSubmodulesAtCommit(repository, commitSha)
  const baselineSubmodules =
    baselineCommitSha === undefined
      ? []
      : await listSubmodulesAtCommit(repository, baselineCommitSha)
  const baselineGitlinks = new Map(
    baselineSubmodules.map(submodule => [submodule.path, submodule.sha])
  )
  const configuredBranches = await getConfiguredSubmoduleBranches(repository)

  for (const submodule of submodules) {
    if (candidatePaths !== undefined && !candidatePaths.has(submodule.path)) {
      continue
    }

    const submoduleRepositoryPath = join(repository.path, submodule.path)
    const baselineGitlink = baselineGitlinks.get(submodule.path)
    if (baselineGitlink === submodule.sha) {
      continue
    }

    if (!(await pathExists(join(submoduleRepositoryPath, '.git')))) {
      if (commitSha !== undefined) {
        throw new Error(
          `Unable to verify submodule "${
            parentPath ? `${parentPath}/${submodule.path}` : submodule.path
          }" because it is not initialized.`
        )
      }

      continue
    }

    const normalizedPath = normalizeSubmoduleRepositoryPath(
      submoduleRepositoryPath
    )
    if (visitedRepositoryPaths.has(normalizedPath)) {
      continue
    }

    visitedRepositoryPaths.add(normalizedPath)

    const submoduleRepository = createSubmoduleRepository(
      submoduleRepositoryPath
    )
    const displayPath = parentPath
      ? `${parentPath}/${submodule.path}`
      : submodule.path

    if (commitSha !== undefined) {
      const objectCheck = await git(
        ['cat-file', '-e', `${submodule.sha}^{commit}`],
        submoduleRepository.path,
        'verifyLocalSubmoduleCommit',
        { successExitCodes: new Set([0, 1, 128]) }
      )

      if (objectCheck.exitCode !== 0) {
        throw new Error(
          `Unable to verify submodule "${displayPath}" because commit ${submodule.sha} is not available locally. Initialize or fetch the submodule, or commit a valid submodule pointer before pushing the parent repository.`
        )
      }
    }

    const status = await getStatus(submoduleRepository)
    if (status === null || status.currentTip === undefined) {
      if (commitSha !== undefined) {
        throw new Error(
          `Unable to verify submodule "${displayPath}" because its repository status is unavailable.`
        )
      }

      continue
    }

    const remotes = await getRemotes(submoduleRepository)
    let remote: IRemote | null = null
    let upstreamBranchName: string | undefined

    if (
      status.currentBranch !== undefined &&
      status.currentUpstreamBranch !== undefined
    ) {
      const upstream = parseUpstreamRef(status.currentUpstreamBranch)
      if (upstream === null) {
        if (commitSha !== undefined) {
          throw new Error(
            `Unable to verify submodule "${displayPath}" because its upstream branch is invalid.`
          )
        }

        continue
      }

      remote = remotes.find(r => r.name === upstream.remoteName) ?? null
      upstreamBranchName = upstream.branchName
    } else {
      remote = findDefaultRemote(remotes)
    }

    if (remote === null) {
      if (commitSha !== undefined) {
        throw new Error(
          `Unable to verify submodule "${displayPath}" because it has no remote.`
        )
      }

      continue
    }

    const referencedCommit =
      commitSha === undefined ? status.currentTip : submodule.sha

    const configuredBranch = configuredBranches.get(submodule.path)
    const resolvedConfiguredBranch =
      configuredBranch === '.' ? repositoryBranchName : configuredBranch
    const remoteBranchName =
      upstreamBranchName ??
      resolvedConfiguredBranch ??
      status.currentBranch ??
      (await getRemoteDefaultBranch(submoduleRepository, remote))

    if (remoteBranchName === undefined) {
      throw new Error(
        `Unable to publish submodule "${displayPath}" because its remote branch could not be determined. Configure its branch in .gitmodules before pushing the parent repository.`
      )
    }

    const publishComparison = await getSubmoduleBranchPublishStrategy(
      submoduleRepository,
      remote,
      remoteBranchName,
      referencedCommit
    )
    if (publishComparison.strategy === 'available') {
      continue
    }
    if (publishComparison.strategy === 'remote-ahead') {
      // A newly added submodule may intentionally pin an older commit. The
      // commit is already published, so the parent can safely reference it.
      if (baselineCommitSha !== undefined && baselineGitlink === undefined) {
        continue
      }

      throw new Error(
        `Unable to publish submodule "${displayPath}" because ${remote.name}/${remoteBranchName} contains remote changes that are not included in commit ${referencedCommit}. Merge or update the submodule before pushing the parent repository.`
      )
    }
    if (publishComparison.strategy === 'diverged') {
      throw new Error(
        `Unable to publish submodule "${displayPath}" because commit ${referencedCommit} has diverged from ${remote.name}/${remoteBranchName}. Merge the remote changes in the submodule before pushing the parent repository.`
      )
    }

    // The referenced parent commit is not available remotely, so publish any
    // unavailable descendants first. Already-published parent commits do not
    // need their complete (and potentially uninitialized) child graph scanned
    // again.
    await collectSubmodulesToPush(
      submoduleRepository,
      displayPath,
      undefined,
      visitedRepositoryPaths,
      pushableSubmodules,
      referencedCommit,
      remoteBranchName,
      publishComparison.remoteTip
    )

    pushableSubmodules.push({
      path: displayPath,
      repository: submoduleRepository,
      remote,
      branchName: referencedCommit,
      remoteBranchName,
    })
  }
}

async function listSubmodulesAtCommit(
  repository: Repository,
  commitSha: string
): Promise<ReadonlyArray<SubmoduleEntry>> {
  const { stdout } = await git(
    ['ls-tree', '-r', '-z', commitSha],
    repository.path,
    'listSubmodulesAtCommit'
  )
  const submodules = new Array<SubmoduleEntry>()

  for (const entry of stdout.split('\0')) {
    const match = /^160000 commit ([0-9a-f]+)\t(.+)$/.exec(entry)
    if (match !== null) {
      submodules.push(new SubmoduleEntry(match[1], match[2], ''))
    }
  }

  return submodules
}

export async function resetSubmodulePaths(
  repository: Repository,
  paths: ReadonlyArray<string>
): Promise<void> {
  if (paths.length === 0) {
    return
  }

  await git(
    ['submodule', 'update', '--recursive', '--force', '--', ...paths],
    repository.path,
    'updateSubmodule'
  )
}
