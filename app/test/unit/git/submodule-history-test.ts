import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import { writeFile } from 'fs/promises'
import { exec } from 'dugite'

import { DiffType } from '../../../src/models/diff'
import { Repository } from '../../../src/models/repository'
import {
  expandChangesetWithSubmoduleChanges,
  getChangedFiles,
  getCommitDiffBetween,
  toSubmoduleCommittedChange,
} from '../../../src/lib/git'
import { setupFixtureRepository } from '../../helpers/repositories'
import { createTempDirectory } from '../../helpers/temp'

describe('git/submodule-history', () => {
  it('expands and renders exact nested pin-to-pin file changes', async t => {
    const rootPath = await setupFixtureRepository(t, 'submodule-basic-setup')
    const rootRepository = new Repository(rootPath, -1, null, false)
    const childPath = Path.join(rootPath, 'foo', 'submodule')
    const nestedPath = await createTempDirectory(t)

    await exec(['init'], nestedPath)
    await exec(['config', 'user.name', 'GitHub Desktop Test'], nestedPath)
    await exec(
      ['config', 'user.email', 'test@githubdesktop.invalid'],
      nestedPath
    )
    await writeFile(Path.join(nestedPath, 'README.md'), 'before\n')
    await exec(['add', 'README.md'], nestedPath)
    await exec(['commit', '-m', 'initial nested commit'], nestedPath)

    await exec(
      [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        nestedPath,
        'nested',
      ],
      childPath
    )
    await exec(['commit', '-am', 'add nested submodule'], childPath)
    await exec(['add', 'foo/submodule'], rootPath)
    await exec(['commit', '-m', 'record nested baseline'], rootPath)

    const nestedCheckoutPath = Path.join(childPath, 'nested')
    await writeFile(Path.join(nestedCheckoutPath, 'README.md'), 'after\n')
    await exec(['commit', '-am', 'change nested file'], nestedCheckoutPath)
    await exec(['commit', '-am', 'update nested pin'], childPath)
    await exec(['add', 'foo/submodule'], rootPath)
    await exec(['commit', '-m', 'update child pin'], rootPath)

    const baseChanges = await getChangedFiles(rootRepository, 'HEAD')
    const expanded = await expandChangesetWithSubmoduleChanges(
      rootRepository,
      baseChanges
    )

    assert.deepEqual(
      expanded.files.map(file => file.path),
      [
        'foo/submodule',
        'foo/submodule/nested',
        'foo/submodule/nested/README.md',
      ]
    )

    const nestedPin = expanded.files[1]
    const nestedFile = expanded.files[2]
    assert.equal(nestedPin.submoduleChange?.depth, 1)
    assert.equal(nestedFile.submoduleChange?.depth, 2)
    assert.equal(nestedFile.submoduleChange?.repositoryPath, nestedCheckoutPath)
    assert.equal(nestedFile.submoduleChange?.pathInSubmodule, 'README.md')

    const repositoryChange = toSubmoduleCommittedChange(nestedFile)
    const diff = await getCommitDiffBetween(
      repositoryChange.repository,
      repositoryChange.file,
      nestedFile.parentCommitish,
      nestedFile.commitish
    )

    assert.equal(diff.kind, DiffType.Text)
    if (diff.kind !== DiffType.Text) {
      throw new Error('Expected a text diff')
    }
    assert.match(diff.text, /-before/)
    assert.match(diff.text, /\+after/)
  })
})
