import { describe, it } from 'node:test'
import assert from 'node:assert'
import { groupRepositories } from '../../src/ui/repositories-list/group-repositories'
import { Repository, ILocalRepositoryState } from '../../src/models/repository'
import { CloningRepository } from '../../src/models/cloning-repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'

describe('repository list grouping', () => {
  const repositories: Array<Repository | CloningRepository> = [
    new Repository('repo1', 1, null, false),
    new Repository(
      'repo2',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'my-repo2' }),
      false
    ),
    new Repository(
      'repo3',
      3,
      gitHubRepoFixture({
        owner: '',
        name: 'my-repo3',
        endpoint: 'https://github.big-corp.com/api/v3',
      }),
      false
    ),
  ]

  const cache = new Map<number, ILocalRepositoryState>()

  it('separates pinned repositories from other repositories', () => {
    const grouped = groupRepositories(repositories, cache, [2])
    assert.equal(grouped.length, 2)
    assert.equal(grouped[0].identifier, 'pinned')
    assert.equal(grouped[1].identifier, 'other')
    assert.equal(grouped[0].items.length, 1)
    assert.equal(grouped[1].items.length, 2)
    assert.equal(grouped[0].items[0].repository.path, 'repo2')
    assert.equal(grouped[0].items[0].isPinned, true)
    assert.equal(grouped[1].items[0].repository.path, 'repo1')
    assert.equal(grouped[1].items[1].repository.path, 'repo3')
    assert.equal(grouped[1].items[0].isPinned, false)
  })

  it('sorts repositories alphabetically within each group', () => {
    const repoA = new Repository('a', 1, null, false)
    const repoB = new Repository(
      'b',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'b' }),
      false
    )
    const repoC = new Repository('c', 2, null, false)
    const repoD = new Repository(
      'd',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'd' }),
      false
    )
    const repoZ = new Repository('z', 3, null, false)

    const grouped = groupRepositories(
      [repoC, repoB, repoZ, repoD, repoA],
      cache,
      [repoZ.id, repoB.id]
    )
    assert.equal(grouped.length, 2)
    assert.equal(grouped[0].identifier, 'pinned')
    assert.equal(grouped[1].identifier, 'other')

    const pinnedItems = grouped[0].items
    assert.equal(pinnedItems[0].repository.path, 'b')
    assert.equal(pinnedItems[1].repository.path, 'z')

    const otherItems = grouped[1].items
    assert.equal(otherItems[0].repository.path, 'a')
    assert.equal(otherItems[1].repository.path, 'c')
    assert.equal(otherItems[2].repository.path, 'd')
  })

  it('disambiguates duplicate repository names across pinned and other groups', () => {
    const repoA = new Repository(
      'repo',
      1,
      gitHubRepoFixture({ owner: 'user1', name: 'repo' }),
      false
    )
    const repoB = new Repository(
      'repo',
      2,
      gitHubRepoFixture({ owner: 'user2', name: 'repo' }),
      false
    )
    const repoC = new Repository(
      'enterprise-repo',
      3,
      gitHubRepoFixture({
        owner: 'business',
        name: 'enterprise-repo',
        endpoint: 'https://ghe.io/api/v3',
      }),
      false
    )
    const repoD = new Repository(
      'enterprise-repo',
      3,
      gitHubRepoFixture({
        owner: 'silliness',
        name: 'enterprise-repo',
        endpoint: 'https://ghe.io/api/v3',
      }),
      false
    )

    const grouped = groupRepositories(
      [repoA, repoB, repoC, repoD],
      cache,
      [repoB.id, repoD.id]
    )
    assert.equal(grouped.length, 2)
    assert.equal(grouped[0].identifier, 'pinned')
    assert.equal(grouped[1].identifier, 'other')
    assert.equal(grouped[0].items.length, 2)
    assert.equal(grouped[1].items.length, 2)

    assert.equal(grouped[0].items[0].text[0], 'enterprise-repo - unknown')
    assert(grouped[0].items[0].needsDisambiguation)
    assert.equal(grouped[0].items[1].text[0], 'repo - unknown')
    assert(grouped[0].items[1].needsDisambiguation)

    assert.equal(grouped[1].items[0].text[0], 'enterprise-repo - unknown')
    assert(grouped[1].items[0].needsDisambiguation)
    assert.equal(grouped[1].items[1].text[0], 'repo - unknown')
    assert(grouped[1].items[1].needsDisambiguation)
  })
})
