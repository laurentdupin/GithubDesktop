import { describe, it } from 'node:test'
import assert from 'node:assert'
import { groupBranches } from '../../src/ui/branches'
import { Branch, BranchType } from '../../src/models/branch'
import { CommitIdentity } from '../../src/models/commit-identity'
import { IShelf } from '../../src/models/shelf'

describe('Branches grouping', () => {
  const author = new CommitIdentity('Hubot', 'hubot@github.com', new Date())

  const branchTip = {
    sha: '300acef',
    author,
  }

  const currentBranch = new Branch(
    'master',
    null,
    branchTip,
    BranchType.Local,
    ''
  )
  const defaultBranch = new Branch(
    'master',
    null,
    branchTip,
    BranchType.Local,
    ''
  )
  const recentBranches = [
    new Branch('some-recent-branch', null, branchTip, BranchType.Local, ''),
  ]
  const otherBranch = new Branch(
    'other-branch',
    null,
    branchTip,
    BranchType.Local,
    ''
  )

  const allBranches = [currentBranch, ...recentBranches, otherBranch]
  const shelfBranch = new Branch(
    'desktop-shelf/game-stuff-abc-12345678',
    null,
    branchTip,
    BranchType.Local,
    ''
  )
  const shelf: IShelf = {
    id: shelfBranch.name,
    name: 'game stuff',
    branchName: shelfBranch.name,
    localRef: shelfBranch.ref,
    remoteRef: null,
    remoteName: null,
    sourceBranchName: 'main',
    sourceHeadSha: 'deadbeef',
    createdAt: new Date(),
    commitSha: branchTip.sha,
    commitSummary: '[shelf] game stuff',
    isPublished: false,
    isRemoteOnly: false,
  }

  it('should group branches', () => {
    const groups = groupBranches(
      defaultBranch,
      currentBranch,
      allBranches,
      recentBranches,
      [],
      []
    )
    assert.equal(groups.length, 3)

    assert.equal(groups[0].identifier, 'default')
    let items = groups[0].items
    assert.equal(items[0].branch, defaultBranch)

    assert.equal(groups[1].identifier, 'recent')
    items = groups[1].items
    assert.equal(items[0].branch, recentBranches[0])

    assert.equal(groups[2].identifier, 'other')
    items = groups[2].items
    assert.equal(items[0].branch, otherBranch)
  })

  it('should group active shelves separately from normal branches', () => {
    const groups = groupBranches(
      defaultBranch,
      currentBranch,
      allBranches,
      recentBranches,
      [shelfBranch],
      [shelf]
    )

    assert.equal(groups.length, 4)
    assert.equal(groups[2].identifier, 'shelves')
    assert.equal(groups[2].items[0].branch, shelfBranch)
    assert.equal(groups[2].items[0].displayName, 'game stuff')
  })

  it('should treat prefixed branches without an active shelf as normal branches', () => {
    const groups = groupBranches(
      defaultBranch,
      currentBranch,
      allBranches,
      recentBranches,
      [shelfBranch],
      []
    )

    assert.equal(groups.length, 3)
    assert.equal(groups[2].identifier, 'other')
    assert.equal(groups[2].items.some(item => item.branch === shelfBranch), true)
  })
})
