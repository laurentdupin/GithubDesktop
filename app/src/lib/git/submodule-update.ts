import * as Path from 'path'

import { Repository } from '../../models/repository'
import {
  ISubmoduleUpdateEntry,
  SubmoduleUpdateStatus,
} from '../../models/submodule-update'
import { pathExists } from '../path-exists'
import { AuthenticationErrors } from './authentication'
import { git } from './core'
import { envForRemoteOperation } from './environment'
import { getRemotes } from './remote'
import { getAheadBehind, revSymmetricDifference } from './rev-list'
import { getStatus } from './status'
import { listSubmodules } from './submodule'

export type SubmoduleUpdateResult =
  | { readonly kind: 'completed' }
  | {
      readonly kind: 'conflicts'
      readonly entry: ISubmoduleUpdateEntry
    }

function createSubmoduleRepository(path: string) {
  return new Repository(path, -1, null, false)
}

async function getConfiguredSubmoduleBranches(repository: Repository) {
  const branches = new Map<string, string>()
  const gitModulesPath = Path.join(repository.path, '.gitmodules')
  if (!(await pathExists(gitModulesPath))) {
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
    'getSubmodulePathsForUpdate',
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
    'getSubmoduleBranchesForUpdate',
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

function parseUpstreamRef(upstreamRef: string) {
  const separatorIndex = upstreamRef.indexOf('/')
  if (separatorIndex === -1) {
    return null
  }

  return {
    remoteName: upstreamRef.slice(0, separatorIndex),
    branchName: upstreamRef.slice(separatorIndex + 1),
  }
}

async function getRemoteDefaultBranch(
  repository: Repository,
  remoteName: string
) {
  const { stdout, exitCode } = await git(
    ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remoteName}/HEAD`],
    repository.path,
    'getSubmoduleRemoteDefaultBranch',
    { successExitCodes: new Set([0, 1, 128]) }
  )

  if (exitCode !== 0) {
    return undefined
  }

  const ref = stdout.trim()
  const prefix = `${remoteName}/`
  return ref.startsWith(prefix) ? ref.slice(prefix.length) : undefined
}

async function fetchSubmoduleBranch(
  repository: Repository,
  remoteName: string,
  remoteUrl: string,
  branchName: string
) {
  const branchRef = `refs/heads/${branchName}`
  const trackingRef = `refs/remotes/${remoteName}/${branchName}`
  await git(
    [
      'fetch',
      '--no-tags',
      '--prune',
      remoteName,
      `+${branchRef}:${trackingRef}`,
    ],
    repository.path,
    'fetchSubmoduleUpdateBranch',
    {
      env: await envForRemoteOperation(remoteUrl),
      expectedErrors: AuthenticationErrors,
    }
  )
}

export async function getSubmoduleUpdatePreview(
  repository: Repository,
  fetchRemotes: boolean
): Promise<ReadonlyArray<ISubmoduleUpdateEntry>> {
  const entries = new Array<ISubmoduleUpdateEntry>()
  const visited = new Set<string>([Path.resolve(repository.path).toLowerCase()])
  const rootStatus = await getStatus(repository)

  await collectSubmoduleUpdates(
    repository,
    '',
    1,
    rootStatus?.currentBranch,
    fetchRemotes,
    visited,
    entries
  )

  return entries
}

async function collectSubmoduleUpdates(
  repository: Repository,
  parentPath: string,
  depth: number,
  parentBranch: string | undefined,
  fetchRemotes: boolean,
  visited: Set<string>,
  entries: Array<ISubmoduleUpdateEntry>
) {
  const submodules = await listSubmodules(repository)
  const configuredBranches = await getConfiguredSubmoduleBranches(repository)

  // Network fetches dominate this scan. Process a few sibling repositories at
  // once without flooding hosts that contain large recursive submodule graphs.
  const concurrency = 4
  for (let index = 0; index < submodules.length; index += concurrency) {
    await Promise.all(
      submodules
        .slice(index, index + concurrency)
        .map(submodule =>
          collectSubmoduleUpdate(
            repository,
            submodule.path,
            configuredBranches.get(submodule.path),
            parentPath,
            depth,
            parentBranch,
            fetchRemotes,
            visited,
            entries
          )
        )
    )
  }
}

async function collectSubmoduleUpdate(
  repository: Repository,
  submodulePath: string,
  configuredBranch: string | undefined,
  parentPath: string,
  depth: number,
  parentBranch: string | undefined,
  fetchRemotes: boolean,
  visited: Set<string>,
  entries: Array<ISubmoduleUpdateEntry>
) {
  const displayPath = parentPath
    ? `${parentPath}/${submodulePath}`
    : submodulePath
  const repositoryPath = Path.join(repository.path, submodulePath)
  const normalizedPath = Path.resolve(repositoryPath).toLowerCase()

  if (!(await pathExists(Path.join(repositoryPath, '.git')))) {
    entries.push({
      path: displayPath,
      repositoryPath,
      depth,
      status: 'uninitialized',
      ahead: 0,
      behind: 0,
      reason: 'The submodule is not initialized.',
    })
    return
  }

  if (visited.has(normalizedPath)) {
    return
  }
  visited.add(normalizedPath)

  const submoduleRepository = createSubmoduleRepository(repositoryPath)
  const status = await getStatus(submoduleRepository)
  if (status === null || status.currentTip === undefined) {
    entries.push({
      path: displayPath,
      repositoryPath,
      depth,
      status: 'branch-required',
      ahead: 0,
      behind: 0,
      reason: 'The submodule status could not be read.',
    })
    return
  }

  const resolvedConfiguredBranch =
    configuredBranch === '.' ? parentBranch : configuredBranch
  const upstream =
    status.currentUpstreamBranch === undefined
      ? null
      : parseUpstreamRef(status.currentUpstreamBranch)
  const remotes = await getRemotes(submoduleRepository)
  const remote =
    remotes.find(item => item.name === upstream?.remoteName) ??
    remotes.find(item => item.name === 'origin') ??
    remotes[0]
  const branchName =
    upstream?.branchName ??
    resolvedConfiguredBranch ??
    status.currentBranch ??
    (remote === undefined
      ? undefined
      : await getRemoteDefaultBranch(submoduleRepository, remote.name))

  let entryStatus: SubmoduleUpdateStatus = 'up-to-date'
  let reason: string | undefined
  let ahead = 0
  let behind = 0
  let remoteSha: string | undefined
  let remoteRef: string | undefined

  if (branchName === undefined || remote === undefined) {
    entryStatus = 'branch-required'
    reason =
      branchName === undefined
        ? 'Configure a branch in .gitmodules for this detached submodule.'
        : 'The submodule has no remote.'
  } else {
    remoteRef = `${remote.name}/${branchName}`
    if (fetchRemotes) {
      log.info(`[SubmoduleUpdate] Fetching ${displayPath} (${remoteRef})`)
      await fetchSubmoduleBranch(
        submoduleRepository,
        remote.name,
        remote.url,
        branchName
      )
    }

    const remoteResult = await git(
      ['rev-parse', '--verify', remoteRef],
      repositoryPath,
      'getSubmoduleUpdateRemoteTip',
      { successExitCodes: new Set([0, 128]) }
    )
    remoteSha =
      remoteResult.exitCode === 0 ? remoteResult.stdout.trim() : undefined

    if (remoteSha === undefined) {
      entryStatus = 'branch-required'
      reason = `Remote branch ${remoteRef} was not found.`
    } else if (status.workingDirectory.files.length > 0) {
      entryStatus = 'dirty'
      reason = 'Commit, shelve, or discard local changes before updating.'
    } else {
      const aheadBehind = await getAheadBehind(
        submoduleRepository,
        revSymmetricDifference(status.currentTip, remoteRef)
      )
      ahead = aheadBehind?.ahead ?? 0
      behind = aheadBehind?.behind ?? 0
      entryStatus =
        ahead > 0 && behind > 0
          ? 'diverged'
          : behind > 0
          ? 'behind'
          : ahead > 0
          ? 'ahead'
          : 'up-to-date'
    }
  }

  entries.push({
    path: displayPath,
    repositoryPath,
    depth,
    status: entryStatus,
    currentSha: status.currentTip,
    remoteSha,
    remoteName: remote?.name,
    branchName,
    remoteRef,
    ahead,
    behind,
    reason,
  })

  await collectSubmoduleUpdates(
    submoduleRepository,
    displayPath,
    depth + 1,
    branchName ?? status.currentBranch,
    fetchRemotes,
    visited,
    entries
  )
}

async function fastForwardSubmodule(entry: ISubmoduleUpdateEntry) {
  if (entry.remoteRef === undefined) {
    return
  }

  const repository = createSubmoduleRepository(entry.repositoryPath)
  const status = await getStatus(repository)
  if (status?.currentBranch === undefined) {
    await git(
      ['checkout', '--detach', entry.remoteRef],
      repository.path,
      'fastForwardDetachedSubmodule'
    )
  } else {
    await git(
      ['merge', '--ff-only', entry.remoteRef],
      repository.path,
      'fastForwardSubmoduleBranch'
    )
  }
}

export async function applySubmoduleUpdates(
  entries: ReadonlyArray<ISubmoduleUpdateEntry>
): Promise<SubmoduleUpdateResult> {
  const updateEntries = entries
    .filter(entry => entry.status === 'behind')
    .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path))

  for (const entry of updateEntries) {
    await fastForwardSubmodule(entry)
  }

  return { kind: 'completed' }
}
