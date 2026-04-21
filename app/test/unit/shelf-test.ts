import assert from 'node:assert'
import { describe, it } from 'node:test'

import { stashSubjectMatchesMessage } from '../../src/lib/git/shelf'
import { Branch, BranchType } from '../../src/models/branch'
import { Commit } from '../../src/models/commit'
import { CommitIdentity } from '../../src/models/commit-identity'
import {
  buildDesktopShelfBranchName,
  filterOutDesktopShelfBranches,
  parseDesktopShelfMetadata,
} from '../../src/models/shelf'

function localBranch(name: string, sha: string) {
  return new Branch(name, `origin/${name}`, { sha }, BranchType.Local, `refs/heads/${name}`)
}

describe('shelf helpers', () => {
  it('filters shelf branches out of the normal branch list', () => {
    const branches = filterOutDesktopShelfBranches([
      localBranch('main', 'main-sha'),
      localBranch('desktop-shelf/game-stuff-abc', 'shelf-sha'),
      localBranch('feature', 'feature-sha'),
    ])

    assert.deepEqual(
      branches.map(branch => branch.name),
      ['main', 'feature']
    )
  })

  it('builds shelf branches with the reserved prefix', () => {
    const branchName = buildDesktopShelfBranchName('Game Stuff', new Date(0))
    assert.ok(branchName.startsWith('desktop-shelf/game-stuff-'))
  })

  it('parses shelf trailers from a shelf commit', () => {
    const commit = new Commit(
      'abc123',
      'abc123',
      '[shelf] Game Stuff',
      [
        'Shelved changes from main.',
        '',
        'Desktop-Shelf-Name: Game Stuff',
        'Desktop-Shelf-Source-Branch: main',
        'Desktop-Shelf-Source-Head: deadbeef',
        'Desktop-Shelf-Created-At: 2026-04-21T12:30:00.000Z',
      ].join('\n'),
      new CommitIdentity('Test', 'test@example.com', new Date('2026-04-21T12:30:00.000Z')),
      new CommitIdentity('Test', 'test@example.com', new Date('2026-04-21T12:30:00.000Z')),
      [],
      [
        { token: 'Desktop-Shelf-Name', value: 'Game Stuff' },
        { token: 'Desktop-Shelf-Source-Branch', value: 'main' },
        { token: 'Desktop-Shelf-Source-Head', value: 'deadbeef' },
        { token: 'Desktop-Shelf-Created-At', value: '2026-04-21T12:30:00.000Z' },
      ],
      []
    )

    const metadata = parseDesktopShelfMetadata(commit)

    assert.equal(metadata.name, 'Game Stuff')
    assert.equal(metadata.sourceBranchName, 'main')
    assert.equal(metadata.sourceHeadSha, 'deadbeef')
    assert.equal(
      metadata.createdAt?.toISOString(),
      '2026-04-21T12:30:00.000Z'
    )
  })

  it('matches shelf stash reflog subjects created by git stash push', () => {
    assert.equal(
      stashSubjectMatchesMessage(
        'On main: DesktopShelf:desktop-shelf/game-stuff-abc',
        'DesktopShelf:desktop-shelf/game-stuff-abc'
      ),
      true
    )

    assert.equal(
      stashSubjectMatchesMessage(
        'DesktopShelf:desktop-shelf/game-stuff-abc',
        'DesktopShelf:desktop-shelf/game-stuff-abc'
      ),
      true
    )

    assert.equal(
      stashSubjectMatchesMessage(
        'On main: DesktopShelf:desktop-shelf/something-else',
        'DesktopShelf:desktop-shelf/game-stuff-abc'
      ),
      false
    )
  })
})
