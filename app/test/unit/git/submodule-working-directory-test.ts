import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as path from 'path'
import { writeFile } from 'fs/promises'
import { exec } from 'dugite'

import { DiffSelectionType } from '../../../src/models/diff'
import { Repository } from '../../../src/models/repository'
import { isSyntheticSubmoduleChange } from '../../../src/models/status'
import {
  expandWorkingDirectoryWithSubmoduleChanges,
  getStatus,
  getSubmoduleRepositoryWorkingDirectory,
  toSubmoduleRepositoryChange,
} from '../../../src/lib/git'
import { setupFixtureRepository } from '../../helpers/repositories'
import { createTempDirectory } from '../../helpers/temp'

describe('git/submodule-working-directory', () => {
  it('returns no submodule working directory when the submodule is clean', async t => {
    const repoPath = await setupFixtureRepository(t, 'submodule-basic-setup')
    const repository = new Repository(repoPath, -1, null, false)

    const submoduleWorkingDirectory = await getSubmoduleRepositoryWorkingDirectory(
      repository,
      'foo/submodule'
    )

    assert.equal(submoduleWorkingDirectory, null)
  })

  it('expands dirty submodule rows into informational child rows', async t => {
    const repoPath = await setupFixtureRepository(t, 'submodule-basic-setup')
    const repository = new Repository(repoPath, -1, null, false)
    const submodulePath = path.join(repoPath, 'foo', 'submodule')

    await writeFile(path.join(submodulePath, 'README.md'), 'hello world\n')

    const status = await getStatus(repository)
    assert(status !== null)

    const expanded = await expandWorkingDirectoryWithSubmoduleChanges(
      repository,
      status.workingDirectory.files
    )

    assert.equal(expanded.length, 2)
    assert.equal(expanded[0].path, 'foo/submodule')
    assert.equal(expanded[1].path, 'foo/submodule/README.md')
    assert.equal(
      expanded[1].selection.getSelectionType(),
      DiffSelectionType.None
    )
    assert.equal(isSyntheticSubmoduleChange(expanded[1]), true)

    if (!isSyntheticSubmoduleChange(expanded[1])) {
      throw new Error('Expected a synthetic submodule change')
    }

    assert.equal(expanded[1].submoduleChange.submodulePath, 'foo/submodule')
    assert.equal(expanded[1].submoduleChange.depth, 1)
    assert.equal(expanded[1].submoduleChange.pathInSubmodule, 'README.md')
  })

  it('expands nested submodule changes recursively with increasing depth', async t => {
    const repoPath = await setupFixtureRepository(t, 'submodule-basic-setup')
    const repository = new Repository(repoPath, -1, null, false)
    const submodulePath = path.join(repoPath, 'foo', 'submodule')
    const nestedRemotePath = await createTempDirectory(t)
    const nestedSeedPath = await createTempDirectory(t)

    await exec(['init', '--bare'], nestedRemotePath)
    await exec(['init'], nestedSeedPath)
    await exec(['config', 'user.name', 'GitHub Desktop Test'], nestedSeedPath)
    await exec(
      ['config', 'user.email', 'test@githubdesktop.invalid'],
      nestedSeedPath
    )
    await writeFile(path.join(nestedSeedPath, 'README.md'), 'nested\n')
    await exec(['add', 'README.md'], nestedSeedPath)
    await exec(['commit', '-m', 'initial nested commit'], nestedSeedPath)
    await exec(['remote', 'add', 'origin', nestedRemotePath], nestedSeedPath)
    await exec(['push', '-u', 'origin', 'HEAD'], nestedSeedPath)

    await exec(
      [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        nestedRemotePath,
        'nested',
      ],
      submodulePath
    )
    await exec(['commit', '-am', 'add nested submodule'], submodulePath)

    const nestedPath = path.join(submodulePath, 'nested')
    await writeFile(path.join(nestedPath, 'nested-change.txt'), 'changed\n')

    const status = await getStatus(repository)
    assert(status !== null)

    const expanded = await expandWorkingDirectoryWithSubmoduleChanges(
      repository,
      status.workingDirectory.files
    )

    assert.deepEqual(
      expanded.map(file => file.path),
      [
        'foo/submodule',
        'foo/submodule/nested',
        'foo/submodule/nested/nested-change.txt',
      ]
    )

    const nestedSubmodule = expanded[1]
    const nestedFile = expanded[2]
    assert(isSyntheticSubmoduleChange(nestedSubmodule))
    assert(isSyntheticSubmoduleChange(nestedFile))
    assert.equal(nestedSubmodule.submoduleChange.depth, 1)
    assert.equal(nestedFile.submoduleChange.depth, 2)
    assert.equal(nestedFile.submoduleChange.submodulePath, 'foo/submodule/nested')
    assert.equal(nestedFile.submoduleChange.submoduleRepositoryPath, nestedPath)
    assert.equal(nestedFile.submoduleChange.pathInSubmodule, 'nested-change.txt')

    const repositoryChange = toSubmoduleRepositoryChange(nestedFile)
    assert.equal(repositoryChange.repository.path, nestedPath)
    assert.equal(repositoryChange.file.path, 'nested-change.txt')
  })
})
