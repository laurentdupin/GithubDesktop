import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as path from 'path'
import { writeFile } from 'fs/promises'

import { DiffSelectionType } from '../../../src/models/diff'
import { Repository } from '../../../src/models/repository'
import { isSyntheticSubmoduleChange } from '../../../src/models/status'
import {
  expandWorkingDirectoryWithSubmoduleChanges,
  getStatus,
  getSubmoduleRepositoryWorkingDirectory,
} from '../../../src/lib/git'
import { setupFixtureRepository } from '../../helpers/repositories'

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
    assert.equal(expanded[1].submoduleChange.pathInSubmodule, 'README.md')
  })
})
