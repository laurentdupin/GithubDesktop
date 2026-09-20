import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as path from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { exec } from 'dugite'

import { Repository } from '../../../src/models/repository'
import {
  getSubmodulesToPush,
  listSubmodules,
  resetSubmodulePaths,
} from '../../../src/lib/git/submodule'
import { checkoutBranch, getBranches, getStatus } from '../../../src/lib/git'
import {
  setupEmptyRepository,
  setupFixtureRepository,
} from '../../helpers/repositories'
import { createTempDirectory } from '../../helpers/temp'

describe('git/submodule', () => {
  describe('listSubmodules', () => {
    it('returns the submodule entry', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const result = await listSubmodules(repository)
      assert.equal(result.length, 1)
      assert.equal(result[0].sha, 'c59617b65080863c4ca72c1f191fa1b423b92223')
      assert.equal(result[0].path, 'foo/submodule')
      assert.equal(result[0].describe, 'first-tag~2')
    })

    it('returns the expected tag', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const submoduleRepository = new Repository(submodulePath, -1, null, false)

      const branches = await getBranches(
        submoduleRepository,
        'refs/remotes/origin/feature-branch'
      )

      if (branches.length === 0) {
        throw new Error(`Could not find branch: feature-branch`)
      }

      await checkoutBranch(submoduleRepository, branches[0], null)

      const result = await listSubmodules(repository)
      assert.equal(result.length, 1)
      assert.equal(result[0].sha, '14425bb2a4ee361af7f789a81b971f8466ae521d')
      assert.equal(result[0].path, 'foo/submodule')
      assert.equal(result[0].describe, 'heads/feature-branch')
    })
  })

  describe('resetSubmodulePaths', () => {
    it('update submodule to original commit', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const submoduleRepository = new Repository(submodulePath, -1, null, false)

      const branches = await getBranches(
        submoduleRepository,
        'refs/remotes/origin/feature-branch'
      )

      if (branches.length === 0) {
        throw new Error(`Could not find branch: feature-branch`)
      }

      await checkoutBranch(submoduleRepository, branches[0], null)

      let result = await listSubmodules(repository)
      assert.equal(result[0].describe, 'heads/feature-branch')

      await resetSubmodulePaths(repository, ['foo/submodule'])

      result = await listSubmodules(repository)
      assert.equal(result[0].describe, 'first-tag~2')
    })

    it('eliminate submodule dirty state', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')

      const filePath = path.join(submodulePath, 'README.md')
      await writeFile(filePath, 'changed', { encoding: 'utf8' })

      await resetSubmodulePaths(repository, ['foo/submodule'])

      const result = await readFile(filePath, { encoding: 'utf8' })
      assert.equal(result, '# submodule-test-case')
    })
  })

  describe('getSubmodulesToPush', () => {
    it('returns no submodules when the submodule branch has no unpublished commits', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)

      const result = await getSubmodulesToPush(repository)
      assert.equal(result.length, 0)
    })

    it('returns a submodule when it has unpublished commits', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const submoduleRepository = new Repository(submodulePath, -1, null, false)

      await writeFile(path.join(submodulePath, 'README.md'), 'changed', {
        encoding: 'utf8',
      })
      await exec(['commit', '-am', 'update submodule'], submodulePath)

      const submoduleStatus = await getStatus(submoduleRepository)
      assert(submoduleStatus !== null)
      assert(submoduleStatus.currentBranch !== undefined)

      const result = await getSubmodulesToPush(repository)
      assert.equal(result.length, 1)
      assert.equal(result[0].path, 'foo/submodule')
      assert.equal(result[0].repository.path, submodulePath)
      assert.equal(result[0].branchName, submoduleStatus.currentTip)
      assert.equal(result[0].remote.name, 'origin')
      assert.equal(result[0].remoteBranchName, submoduleStatus.currentBranch)
    })

    it('requires explicit intervention for a diverged submodule commit', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const remotePath = await createTempDirectory(t)
      const remoteUpdaterPath = await createTempDirectory(t)

      await exec(['init', '--bare'], remotePath)
      await exec(['remote', 'set-url', 'origin', remotePath], submodulePath)
      await exec(['push', '-u', 'origin', 'master'], submodulePath)

      await writeFile(path.join(submodulePath, 'README.md'), 'local change')
      await exec(['commit', '-am', 'local change'], submodulePath)
      await exec(['clone', remotePath, remoteUpdaterPath], testRepoPath)
      await exec(
        ['config', 'user.name', 'GitHub Desktop Test'],
        remoteUpdaterPath
      )
      await exec(
        ['config', 'user.email', 'test@githubdesktop.invalid'],
        remoteUpdaterPath
      )
      await writeFile(
        path.join(remoteUpdaterPath, 'README.md'),
        'remote change'
      )
      await exec(['commit', '-am', 'remote change'], remoteUpdaterPath)
      await exec(['push', 'origin', 'master'], remoteUpdaterPath)

      await assert.rejects(
        getSubmodulesToPush(repository),
        /has diverged from origin\/master/
      )
    })

    it('publishes an unavailable detached commit to the established branch', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')

      await writeFile(path.join(submodulePath, 'README.md'), 'detached change')
      await exec(['commit', '-am', 'detached submodule commit'], submodulePath)
      const head = (
        await exec(['rev-parse', 'HEAD'], submodulePath)
      ).stdout.trim()
      await exec(['tag', 'local-only-tag', head], submodulePath)
      await exec(['checkout', '--detach', head], submodulePath)

      const result = await getSubmodulesToPush(repository)
      assert.equal(result.length, 1)
      assert.equal(result[0].branchName, head)
      assert.equal(result[0].remoteBranchName, 'master')

      const status = await getStatus(
        new Repository(submodulePath, -1, null, false)
      )
      assert.equal(status?.currentBranch, undefined)
      assert.equal(status?.currentTip, head)
    })

    it('skips a detached commit already available from its remote', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const head = (
        await exec(['rev-parse', 'HEAD'], submodulePath)
      ).stdout.trim()

      await exec(['checkout', '--detach', head], submodulePath)

      const result = await getSubmodulesToPush(repository)
      assert.equal(result.length, 0)
    })

    it('stops when a detached submodule has remote changes', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const remotePath = await createTempDirectory(t)
      const remoteUpdaterPath = await createTempDirectory(t)

      await exec(['init', '--bare'], remotePath)
      await exec(['remote', 'set-url', 'origin', remotePath], submodulePath)
      await exec(['push', '-u', 'origin', 'master'], submodulePath)
      const publishedCommit = (
        await exec(['rev-parse', 'HEAD'], submodulePath)
      ).stdout.trim()
      await exec(['checkout', '--detach', publishedCommit], submodulePath)

      await exec(['clone', remotePath, remoteUpdaterPath], testRepoPath)
      await exec(
        ['config', 'user.name', 'GitHub Desktop Test'],
        remoteUpdaterPath
      )
      await exec(
        ['config', 'user.email', 'test@githubdesktop.invalid'],
        remoteUpdaterPath
      )
      await writeFile(path.join(remoteUpdaterPath, 'remote.txt'), 'newer')
      await exec(['add', 'remote.txt'], remoteUpdaterPath)
      await exec(['commit', '-m', 'advance remote branch'], remoteUpdaterPath)
      await exec(['push', 'origin', 'master'], remoteUpdaterPath)

      await assert.rejects(
        getSubmodulesToPush(repository),
        /contains remote changes that are not included/
      )
    })

    it('ignores remote changes for an unchanged gitlink', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const parentRemotePath = await createTempDirectory(t)
      const submoduleRemotePath = await createTempDirectory(t)
      const remoteUpdaterPath = await createTempDirectory(t)

      await exec(['init', '--bare'], parentRemotePath)
      await exec(['remote', 'add', 'origin', parentRemotePath], testRepoPath)
      await exec(['push', '-u', 'origin', 'master'], testRepoPath)

      await exec(['init', '--bare'], submoduleRemotePath)
      await exec(
        ['remote', 'set-url', 'origin', submoduleRemotePath],
        submodulePath
      )
      await exec(['push', '-u', 'origin', 'master'], submodulePath)

      await exec(
        ['clone', submoduleRemotePath, remoteUpdaterPath],
        testRepoPath
      )
      await exec(
        ['config', 'user.name', 'GitHub Desktop Test'],
        remoteUpdaterPath
      )
      await exec(
        ['config', 'user.email', 'test@githubdesktop.invalid'],
        remoteUpdaterPath
      )
      await writeFile(path.join(remoteUpdaterPath, 'remote.txt'), 'newer')
      await exec(['add', 'remote.txt'], remoteUpdaterPath)
      await exec(['commit', '-m', 'advance remote branch'], remoteUpdaterPath)
      await exec(['push', 'origin', 'master'], remoteUpdaterPath)

      const parentCommit = (
        await exec(['rev-parse', 'HEAD'], testRepoPath)
      ).stdout.trim()
      const result = await getSubmodulesToPush(
        repository,
        undefined,
        parentCommit
      )
      assert.equal(result.length, 0)
    })

    it('allows a newly added submodule to pin an older published commit', async t => {
      const repository = await setupEmptyRepository(t)
      const parentRemotePath = await createTempDirectory(t)
      const submodule = await setupEmptyRepository(t)
      const submoduleRemotePath = await createTempDirectory(t)

      await writeFile(path.join(repository.path, 'README.md'), 'parent')
      await exec(['add', 'README.md'], repository.path)
      await exec(['commit', '-m', 'initial parent'], repository.path)
      await exec(['init', '--bare'], parentRemotePath)
      await exec(['remote', 'add', 'origin', parentRemotePath], repository.path)
      await exec(['push', '-u', 'origin', 'master'], repository.path)

      await writeFile(path.join(submodule.path, 'README.md'), 'first')
      await exec(['add', 'README.md'], submodule.path)
      await exec(['commit', '-m', 'first submodule commit'], submodule.path)
      const pinnedCommit = (
        await exec(['rev-parse', 'HEAD'], submodule.path)
      ).stdout.trim()
      await writeFile(path.join(submodule.path, 'README.md'), 'second')
      await exec(['commit', '-am', 'advance submodule'], submodule.path)
      await exec(['init', '--bare'], submoduleRemotePath)
      await exec(
        ['remote', 'add', 'origin', submoduleRemotePath],
        submodule.path
      )
      await exec(['push', '-u', 'origin', 'master'], submodule.path)

      await exec(
        [
          '-c',
          'protocol.file.allow=always',
          'submodule',
          'add',
          submoduleRemotePath,
          'new-submodule',
        ],
        repository.path
      )
      const submodulePath = path.join(repository.path, 'new-submodule')
      await exec(['checkout', '--detach', pinnedCommit], submodulePath)
      await exec(['add', '.gitmodules', 'new-submodule'], repository.path)
      await exec(['commit', '-m', 'add pinned submodule'], repository.path)
      const parentCommit = (
        await exec(['rev-parse', 'HEAD'], repository.path)
      ).stdout.trim()

      const result = await getSubmodulesToPush(
        repository,
        undefined,
        parentCommit
      )
      assert.equal(result.length, 0)
    })

    it('does not treat a synthetic remote tag as branch publication', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const remotePath = await createTempDirectory(t)

      await exec(['init', '--bare'], remotePath)
      await exec(['remote', 'set-url', 'origin', remotePath], submodulePath)
      await exec(['push', '-u', 'origin', 'master'], submodulePath)

      await writeFile(path.join(submodulePath, 'README.md'), 'tagged change')
      await exec(['commit', '-am', 'tagged submodule commit'], submodulePath)
      const head = (
        await exec(['rev-parse', 'HEAD'], submodulePath)
      ).stdout.trim()
      await exec(
        ['push', 'origin', `${head}:refs/tags/desktop-submodule/${head}`],
        submodulePath
      )
      await exec(['checkout', '--detach', head], submodulePath)

      const result = await getSubmodulesToPush(repository)
      assert.equal(result.length, 1)
      assert.equal(result[0].branchName, head)
      assert.equal(result[0].remoteBranchName, 'master')
    })

    it('checks the gitlink recorded in the parent commit instead of the submodule checkout', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')

      await writeFile(path.join(submodulePath, 'README.md'), 'unpublished')
      await exec(
        ['commit', '-am', 'unpublished submodule commit'],
        submodulePath
      )
      const recordedCommit = (
        await exec(['rev-parse', 'HEAD'], submodulePath)
      ).stdout.trim()
      await exec(['add', 'foo/submodule'], testRepoPath)
      await exec(['commit', '-m', 'record unpublished gitlink'], testRepoPath)
      const parentCommit = (
        await exec(['rev-parse', 'HEAD'], testRepoPath)
      ).stdout.trim()

      await exec(['checkout', '--detach', 'HEAD^'], submodulePath)

      const result = await getSubmodulesToPush(
        repository,
        undefined,
        parentCommit
      )
      assert.equal(result.length, 1)
      assert.equal(result[0].branchName, recordedCommit)
      assert.equal(result[0].remoteBranchName, 'master')
    })

    it('fails closed when a gitlink in the parent commit is not initialized', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const parentCommit = (
        await exec(['rev-parse', 'HEAD'], testRepoPath)
      ).stdout.trim()

      await exec(['submodule', 'deinit', '-f', 'foo/submodule'], testRepoPath)

      await assert.rejects(
        getSubmodulesToPush(repository, undefined, parentCommit),
        /not initialized/
      )
    })

    it('skips a proven descendant before requiring intervention for its diverged parent', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const submoduleRemotePath = await createTempDirectory(t)
      const nestedRemotePath = await createTempDirectory(t)
      const nestedSeedPath = await createTempDirectory(t)
      const nestedPath = path.join(submodulePath, 'nested')

      await exec(['init', '--bare'], submoduleRemotePath)
      await exec(
        ['remote', 'set-url', 'origin', submoduleRemotePath],
        submodulePath
      )
      await exec(['push', '-u', 'origin', 'master'], submodulePath)

      await exec(['init', '--bare'], nestedRemotePath)
      await exec(['init'], nestedSeedPath)
      await exec(['config', 'user.name', 'GitHub Desktop Test'], nestedSeedPath)
      await exec(
        ['config', 'user.email', 'test@githubdesktop.invalid'],
        nestedSeedPath
      )
      await writeFile(path.join(nestedSeedPath, 'README.md'), 'nested')
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
      await exec(['push', 'origin', 'master'], submodulePath)

      await writeFile(path.join(nestedPath, 'README.md'), 'nested updated')
      await exec(['commit', '-am', 'update nested'], nestedPath)
      await exec(['commit', '-am', 'update nested pointer'], submodulePath)
      await exec(['push', 'origin', 'master'], submodulePath)
      await exec(['reset', '--hard', 'HEAD^'], submodulePath)

      // Simulate a checkout whose remote-tracking ref was not refreshed after
      // the server branch advanced to a different nested gitlink. The
      // unchanged candidate gitlink remains proven by the reachable history
      // of the advertised server tip.
      await exec(
        ['update-ref', 'refs/remotes/origin/master', 'HEAD'],
        submodulePath
      )
      await exec(['submodule', 'deinit', '-f', 'nested'], submodulePath)

      await writeFile(path.join(submodulePath, 'README.md'), 'parent change')
      await exec(['commit', '-am', 'update parent only'], submodulePath)
      await exec(['add', 'foo/submodule'], testRepoPath)
      await exec(['commit', '-m', 'record unpublished parent'], testRepoPath)
      const parentCommit = (
        await exec(['rev-parse', 'HEAD'], testRepoPath)
      ).stdout.trim()

      await assert.rejects(
        getSubmodulesToPush(repository, undefined, parentCommit),
        /has diverged from origin\/master/
      )
    })

    it('fails closed with a clear error when a recorded gitlink object is missing', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const missingCommit = '1111111111111111111111111111111111111111'

      await exec(
        [
          'update-index',
          '--cacheinfo',
          `160000,${missingCommit},foo/submodule`,
        ],
        testRepoPath
      )
      await exec(['commit', '-m', 'record missing gitlink'], testRepoPath)
      const parentCommit = (
        await exec(['rev-parse', 'HEAD'], testRepoPath)
      ).stdout.trim()

      await assert.rejects(
        getSubmodulesToPush(repository, undefined, parentCommit),
        /commit 1111111111111111111111111111111111111111 is not available locally/
      )
    })

    it('returns nested submodules before their parents', async t => {
      const testRepoPath = await setupFixtureRepository(
        t,
        'submodule-basic-setup'
      )
      const repository = new Repository(testRepoPath, -1, null, false)
      const submodulePath = path.join(testRepoPath, 'foo', 'submodule')
      const nestedRemotePath = await createTempDirectory(t)
      const nestedSeedPath = await createTempDirectory(t)

      await exec(['init', '--bare'], nestedRemotePath)
      await exec(['init'], nestedSeedPath)
      await exec(['config', 'user.name', 'GitHub Desktop Test'], nestedSeedPath)
      await exec(
        ['config', 'user.email', 'test@githubdesktop.invalid'],
        nestedSeedPath
      )
      await writeFile(path.join(nestedSeedPath, 'README.md'), 'nested')
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
      await mkdir(path.join(nestedPath, 'new-directory'))
      await writeFile(
        path.join(nestedPath, 'new-directory', 'change.txt'),
        'changed'
      )
      await exec(['add', '.'], nestedPath)
      await exec(['commit', '-m', 'update nested submodule'], nestedPath)
      await exec(
        ['commit', '-am', 'update nested submodule pointer'],
        submodulePath
      )
      await exec(['add', 'foo/submodule'], testRepoPath)
      await exec(
        ['commit', '-m', 'update parent submodule pointer'],
        testRepoPath
      )
      const parentCommit = (
        await exec(['rev-parse', 'HEAD'], testRepoPath)
      ).stdout.trim()

      const result = await getSubmodulesToPush(
        repository,
        undefined,
        parentCommit
      )
      assert.deepEqual(
        result.map(x => x.path),
        ['foo/submodule/nested', 'foo/submodule']
      )
    })
  })
})
