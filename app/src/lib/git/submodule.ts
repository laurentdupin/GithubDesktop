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
import { getAheadBehind, revSymmetricDifference } from './rev-list'

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

async function shouldPushSubmodule(
  repository: Repository,
  currentBranch: string,
  remote: IRemote,
  remoteBranchName: string | null,
  branchAheadBehind: { ahead: number; behind: number } | undefined
) {
  if (branchAheadBehind !== undefined) {
    return branchAheadBehind.ahead > 0
  }

  const remoteBranchRef =
    remoteBranchName === null
      ? `${remote.name}/${currentBranch}`
      : `${remote.name}/${remoteBranchName}`

  const aheadBehind = await getAheadBehind(
    repository,
    revSymmetricDifference(currentBranch, remoteBranchRef)
  )

  return aheadBehind === null || aheadBehind.ahead > 0
}

async function isCommitAvailableOnRemote(
  repository: Repository,
  remote: IRemote,
  commitSha: string
) {
  const { stdout: remoteBranches } = await git(
    [
      'for-each-ref',
      '--contains',
      commitSha,
      '--format=%(refname)',
      `refs/remotes/${remote.name}/`,
    ],
    repository.path,
    'isSubmoduleCommitAvailableOnRemote'
  )

  const remoteBranchRefs = remoteBranches
    .split('\n')
    .map(ref => ref.trim())
    .filter(ref => ref.length > 0 && !ref.endsWith('/HEAD'))
    .map(ref =>
      ref.replace(`refs/remotes/${remote.name}/`, 'refs/heads/')
    )

  if (remoteBranchRefs.length > 0) {
    const { stdout: advertisedBranches } = await git(
      ['ls-remote', '--heads', remote.name, ...remoteBranchRefs],
      repository.path,
      'verifyRemoteSubmoduleBranches',
      {
        env: await envForRemoteOperation(remote.url),
        expectedErrors: AuthenticationErrors,
      }
    )

    for (const line of advertisedBranches.split('\n')) {
      const [tip] = line.split('\t')
      if (tip === commitSha) {
        return true
      }

      if (tip?.length > 0) {
        const result = await git(
          ['merge-base', '--is-ancestor', commitSha, tip],
          repository.path,
          'verifySubmoduleCommitAncestor',
          { successExitCodes: new Set([0, 1, 128]) }
        )

        if (result.exitCode === 0) {
          return true
        }
      }
    }
  }

  const { stdout: localTags } = await git(
    ['tag', '--points-at', commitSha],
    repository.path,
    'getSubmoduleCommitTags'
  )
  const tagNames = localTags.split('\n').filter(x => x.length > 0)
  const syntheticTag = `refs/tags/desktop-submodule/${commitSha}`
  const tagRefs = [
    syntheticTag,
    `${syntheticTag}^{}`,
    ...tagNames.flatMap(tagName => [
      `refs/tags/${tagName}`,
      `refs/tags/${tagName}^{}`,
    ]),
  ]
  const { stdout: remoteTags } = await git(
    ['ls-remote', '--tags', remote.name, ...tagRefs],
    repository.path,
    'getRemoteSubmoduleCommitTags',
    {
      env: await envForRemoteOperation(remote.url),
      expectedErrors: AuthenticationErrors,
    }
  )

  return remoteTags
    .split('\n')
    .some(line => line.startsWith(`${commitSha}\t`))
}

function gitlinkKey(path: string, sha: string) {
  return `${path}\0${sha}`
}

/**
 * Find gitlinks which are already recorded by the verified tips of configured
 * remote branches. An unchanged, uninitialized child does not need to be
 * traversed again when publishing a newer parent commit: the remote parent
 * already proves that exact gitlink was published previously.
 *
 * Only local remote-tracking refs which still exactly match the server's
 * advertised branch tips are trusted. A stale or rewritten tracking ref must
 * not weaken the push safety check.
 */
async function getGitlinksRecordedOnRemoteTips(repository: Repository) {
  const gitlinks = new Set<string>()
  const remotes = await getRemotes(repository)

  for (const remote of remotes) {
    const remoteTrackingPrefix = `refs/remotes/${remote.name}/`
    const { stdout: localRemoteBranches } = await git(
      [
        'for-each-ref',
        '--format=%(objectname) %(refname)',
        remoteTrackingPrefix,
      ],
      repository.path,
      'getLocalRemoteBranchesForSubmodulePush'
    )

    const localTips = new Map<string, { sha: string; localRef: string }>()
    for (const line of localRemoteBranches.split('\n')) {
      const separatorIndex = line.indexOf(' ')
      if (separatorIndex === -1) {
        continue
      }

      const sha = line.slice(0, separatorIndex)
      const localRef = line.slice(separatorIndex + 1)
      if (localRef.endsWith('/HEAD')) {
        continue
      }

      const branchName = localRef.slice(remoteTrackingPrefix.length)
      localTips.set(`refs/heads/${branchName}`, { sha, localRef })
    }

    if (localTips.size === 0) {
      continue
    }

    const { stdout: advertisedBranches } = await git(
      ['ls-remote', '--heads', remote.name, ...localTips.keys()],
      repository.path,
      'verifyRemoteParentBranchesForSubmodulePush',
      {
        env: await envForRemoteOperation(remote.url),
        expectedErrors: AuthenticationErrors,
      }
    )

    for (const line of advertisedBranches.split('\n')) {
      const [advertisedSha, remoteRef] = line.split('\t')
      const localTip =
        remoteRef === undefined ? undefined : localTips.get(remoteRef)
      if (localTip === undefined || localTip.sha !== advertisedSha) {
        continue
      }

      for (const submodule of await listSubmodulesAtCommit(
        repository,
        localTip.localRef
      )) {
        gitlinks.add(gitlinkKey(submodule.path, submodule.sha))
      }
    }
  }

  return gitlinks
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

  await collectSubmodulesToPush(
    repository,
    '',
    candidatePaths,
    visitedRepositoryPaths,
    pushableSubmodules,
    commitSha
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
  commitSha?: string
): Promise<void> {
  const submodules =
    commitSha === undefined
      ? await listSubmodules(repository)
      : await listSubmodulesAtCommit(repository, commitSha)
  let remoteTipGitlinks: ReadonlySet<string> | undefined

  for (const submodule of submodules) {
    if (candidatePaths !== undefined && !candidatePaths.has(submodule.path)) {
      continue
    }

    const submoduleRepositoryPath = join(repository.path, submodule.path)
    if (!(await pathExists(join(submoduleRepositoryPath, '.git')))) {
      if (commitSha !== undefined) {
        remoteTipGitlinks ??= await getGitlinksRecordedOnRemoteTips(repository)
        if (remoteTipGitlinks.has(gitlinkKey(submodule.path, submodule.sha))) {
          continue
        }

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

    const submoduleRepository = createSubmoduleRepository(submoduleRepositoryPath)
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
    let remoteBranchName: string | null = null

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
      remoteBranchName = upstream.branchName
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

    if (
      await isCommitAvailableOnRemote(
        submoduleRepository,
        remote,
        referencedCommit
      )
    ) {
      continue
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
      referencedCommit
    )

    if (
      status.currentBranch === undefined ||
      status.currentTip !== referencedCommit
    ) {
      pushableSubmodules.push({
        path: displayPath,
        repository: submoduleRepository,
        remote,
        branchName: referencedCommit,
        remoteBranchName: `refs/tags/desktop-submodule/${referencedCommit}`,
      })
      continue
    }

    if (
      commitSha === undefined &&
      !(await shouldPushSubmodule(
        submoduleRepository,
        status.currentBranch,
        remote,
        remoteBranchName,
        status.branchAheadBehind
      ))
    ) {
      continue
    }

    pushableSubmodules.push({
      path: displayPath,
      repository: submoduleRepository,
      remote,
      branchName: status.currentBranch,
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
