import { describe, it, TestContext } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import { exec } from 'dugite'
import { writeFile } from 'fs/promises'

import {
  applySubmoduleUpdates,
  getSubmoduleUpdatePreview,
} from '../../../src/lib/git'
import { setupEmptyRepository } from '../../helpers/repositories'
import { makeCommit } from '../../helpers/repository-scaffolding'
import { createTempDirectory } from '../../helpers/temp'

async function setupConfiguredSubmodule(
  t: TestContext,
  configureBranch = true
) {
  const child = await setupEmptyRepository(t, 'main')
  await makeCommit(child, {
    entries: [{ path: 'README.md', contents: 'initial\n' }],
    commitMessage: 'initial child commit',
  })

  const childRemote = await createTempDirectory(t)
  await exec(['init', '--bare'], childRemote)
  await exec(['remote', 'add', 'origin', childRemote], child.path)
  await exec(['push', '-u', 'origin', 'main'], child.path)
  await exec(['symbolic-ref', 'HEAD', 'refs/heads/main'], childRemote)

  const parent = await setupEmptyRepository(t, 'main')
  await makeCommit(parent, {
    entries: [{ path: 'README.md', contents: 'parent\n' }],
    commitMessage: 'initial parent commit',
  })
  await exec(
    [
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      childRemote,
      'child',
    ],
    parent.path
  )
  if (configureBranch) {
    await exec(
      ['config', '--file', '.gitmodules', 'submodule.child.branch', 'main'],
      parent.path
    )
  }
  await exec(['add', '.gitmodules', 'child'], parent.path)
  await exec(['commit', '-m', 'add child submodule'], parent.path)

  const childCheckout = Path.join(parent.path, 'child')
  await exec(['checkout', '--detach', 'HEAD'], childCheckout)

  return { child, parent, childCheckout }
}

describe('git/submodule-update', () => {
  it('fetches and fast-forwards a configured detached submodule', async t => {
    const { child, parent, childCheckout } = await setupConfiguredSubmodule(t)

    await makeCommit(child, {
      entries: [{ path: 'remote.txt', contents: 'from another machine\n' }],
      commitMessage: 'remote child work',
    })
    await exec(['push', 'origin', 'main'], child.path)
    const remoteTip = (
      await exec(['rev-parse', 'HEAD'], child.path)
    ).stdout.trim()

    const entries = await getSubmoduleUpdatePreview(parent, true)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].path, 'child')
    assert.equal(entries[0].branchName, 'main')
    assert.equal(entries[0].status, 'behind')
    assert.equal(entries[0].behind, 1)

    const result = await applySubmoduleUpdates(entries)
    assert.equal(result.kind, 'completed')

    const updatedTip = (
      await exec(['rev-parse', 'HEAD'], childCheckout)
    ).stdout.trim()
    assert.equal(updatedTip, remoteTip)

    const parentStatus = (
      await exec(['status', '--porcelain'], parent.path)
    ).stdout.trim()
    assert.equal(parentStatus, 'M child')
  })

  it('leaves a divergent detached submodule unchanged', async t => {
    const { child, parent, childCheckout } = await setupConfiguredSubmodule(
      t,
      false
    )

    await writeFile(Path.join(childCheckout, 'README.md'), 'local work\n')
    await exec(['add', 'README.md'], childCheckout)
    await exec(['commit', '-m', 'local child work'], childCheckout)

    await makeCommit(child, {
      entries: [{ path: 'README.md', contents: 'remote work\n' }],
      commitMessage: 'remote child work',
    })
    await exec(['push', 'origin', 'main'], child.path)

    const entries = await getSubmoduleUpdatePreview(parent, true)
    assert.equal(entries[0].status, 'diverged')

    const result = await applySubmoduleUpdates(entries)
    assert.equal(result.kind, 'completed')

    const branch = (
      await exec(['branch', '--show-current'], childCheckout)
    ).stdout.trim()
    assert.equal(branch, '')

    const currentTip = (
      await exec(['rev-parse', 'HEAD'], childCheckout)
    ).stdout.trim()
    assert.equal(currentTip, entries[0].currentSha)
    assert.equal(
      (await exec(['status', '--porcelain'], childCheckout)).stdout.trim(),
      ''
    )
  })
})
