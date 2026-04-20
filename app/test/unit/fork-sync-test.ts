import assert from 'node:assert'
import { describe, it } from 'node:test'

import { Branch, BranchType } from '../../src/models/branch'
import {
  buildForkSyncSummary,
  getForkSyncCandidateBranches,
  IForkSyncContext,
  sortForkSyncPreviewEntries,
  summarizeForkSyncPreviewEntries,
} from '../../src/models/fork-sync'

function localBranch(name: string, sha: string) {
  return new Branch(name, `origin/${name}`, { sha }, BranchType.Local, `refs/heads/${name}`)
}

function remoteBranch(remoteName: string, name: string, sha: string) {
  return new Branch(
    `${remoteName}/${name}`,
    null,
    { sha },
    BranchType.Remote,
    `refs/remotes/${remoteName}/${name}`
  )
}

describe('fork sync', () => {
  it('matches same-name branches on origin and upstream and sorts the default branch first', () => {
    const candidates = getForkSyncCandidateBranches(
      [
        localBranch('feature', 'feature-local'),
        localBranch('main', 'main-local'),
        remoteBranch('origin', 'feature', 'feature-origin'),
        remoteBranch('upstream', 'feature', 'feature-upstream'),
        remoteBranch('origin', 'main', 'main-origin'),
        remoteBranch('upstream', 'main', 'main-upstream'),
        remoteBranch('origin', 'origin-only', 'origin-only'),
        remoteBranch('upstream', 'upstream-only', 'upstream-only'),
      ],
      'main',
      'origin',
      'upstream'
    )

    assert.equal(candidates.length, 2)
    assert.equal(candidates[0].branchName, 'main')
    assert.equal(candidates[1].branchName, 'feature')
    assert.equal(candidates[0].localBranch?.name, 'main')
    assert.equal(candidates[1].localBranch?.name, 'feature')
  })

  it('includes remote-only matches with a null local branch', () => {
    const candidates = getForkSyncCandidateBranches(
      [
        remoteBranch('origin', 'release', 'origin-release'),
        remoteBranch('upstream', 'release', 'upstream-release'),
      ],
      null,
      'origin',
      'upstream'
    )

    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].branchName, 'release')
    assert.equal(candidates[0].localBranch, null)
  })

  it('builds summary counts from completed and skipped entries', () => {
    const context: IForkSyncContext = {
      originalBranchName: 'main',
      remainingEntries: [],
      completedEntries: [
        { branchName: 'main', status: 'synced' },
        { branchName: 'feature', status: 'up-to-date' },
      ],
      skippedEntries: [
        {
          branchName: 'release',
          localRef: null,
          originRef: 'refs/remotes/origin/release',
          upstreamRef: 'refs/remotes/upstream/release',
          status: 'skipped-no-local',
          commitCountFromParent: 0,
          skipReason: 'Local branch is missing.',
          willPush: false,
        },
      ],
      autoPush: true,
      stoppedEntry: {
        branchName: 'hotfix',
        reason: 'Push to origin failed.',
      },
    }

    const summary = buildForkSyncSummary(context)

    assert.equal(summary.syncedCount, 1)
    assert.equal(summary.upToDateCount, 1)
    assert.equal(summary.skippedCount, 1)
    assert.equal(summary.stoppedEntry?.branchName, 'hotfix')
  })

  it('sorts preview entries by mergeability and then alphabetically', () => {
    const entries = sortForkSyncPreviewEntries([
      {
        branchName: 'release',
        localRef: 'refs/heads/release',
        originRef: 'refs/remotes/origin/release',
        upstreamRef: 'refs/remotes/upstream/release',
        status: 'conflicts',
        commitCountFromParent: 3,
        willPush: true,
      },
      {
        branchName: 'beta',
        localRef: 'refs/heads/beta',
        originRef: 'refs/remotes/origin/beta',
        upstreamRef: 'refs/remotes/upstream/beta',
        status: 'needs-sync',
        commitCountFromParent: 2,
        willPush: true,
      },
      {
        branchName: 'alpha',
        localRef: 'refs/heads/alpha',
        originRef: 'refs/remotes/origin/alpha',
        upstreamRef: 'refs/remotes/upstream/alpha',
        status: 'needs-sync',
        commitCountFromParent: 1,
        willPush: true,
      },
      {
        branchName: 'gamma',
        localRef: null,
        originRef: 'refs/remotes/origin/gamma',
        upstreamRef: 'refs/remotes/upstream/gamma',
        status: 'skipped-no-local',
        commitCountFromParent: 0,
        willPush: false,
      },
      {
        branchName: 'delta',
        localRef: 'refs/heads/delta',
        originRef: 'refs/remotes/origin/delta',
        upstreamRef: 'refs/remotes/upstream/delta',
        status: 'up-to-date',
        commitCountFromParent: 0,
        willPush: false,
      },
    ])

    assert.deepEqual(
      entries.map(entry => `${entry.status}:${entry.branchName}`),
      [
        'needs-sync:alpha',
        'needs-sync:beta',
        'conflicts:release',
        'up-to-date:delta',
        'skipped-no-local:gamma',
      ]
    )
  })

  it('summarizes syncable and skipped preview counts', () => {
    const stats = summarizeForkSyncPreviewEntries([
      {
        branchName: 'alpha',
        localRef: 'refs/heads/alpha',
        originRef: 'refs/remotes/origin/alpha',
        upstreamRef: 'refs/remotes/upstream/alpha',
        status: 'needs-sync',
        commitCountFromParent: 1,
        willPush: true,
      },
      {
        branchName: 'beta',
        localRef: 'refs/heads/beta',
        originRef: 'refs/remotes/origin/beta',
        upstreamRef: 'refs/remotes/upstream/beta',
        status: 'conflicts',
        commitCountFromParent: 2,
        willPush: true,
      },
      {
        branchName: 'gamma',
        localRef: null,
        originRef: 'refs/remotes/origin/gamma',
        upstreamRef: 'refs/remotes/upstream/gamma',
        status: 'skipped-no-local',
        commitCountFromParent: 0,
        willPush: false,
      },
    ])

    assert.equal(stats.readyToMergeCount, 1)
    assert.equal(stats.conflictsCount, 1)
    assert.equal(stats.skippedNoLocalCount, 1)
    assert.equal(stats.syncableCount, 2)
  })
})
