import { Branch } from './branch'
import { Commit } from './commit'

export const DesktopShelfBranchPrefix = 'desktop-shelf/'

export const DesktopShelfNameTrailer = 'Desktop-Shelf-Name'
export const DesktopShelfSourceBranchTrailer = 'Desktop-Shelf-Source-Branch'
export const DesktopShelfSourceHeadTrailer = 'Desktop-Shelf-Source-Head'
export const DesktopShelfCreatedAtTrailer = 'Desktop-Shelf-Created-At'

export interface IShelf {
  readonly id: string
  readonly name: string
  readonly branchName: string
  readonly localRef: string | null
  readonly remoteRef: string | null
  readonly remoteName: string | null
  readonly sourceBranchName: string | null
  readonly sourceHeadSha: string | null
  readonly createdAt: Date | null
  readonly commitSha: string
  readonly commitSummary: string
  readonly isPublished: boolean
  readonly isRemoteOnly: boolean
}

export type ShelfActionKind = 'publishing' | 'unshelving'

export interface IShelfActionProgress {
  readonly kind: ShelfActionKind
  readonly shelfId: string
}

export interface IShelfMetadata {
  readonly name: string | null
  readonly sourceBranchName: string | null
  readonly sourceHeadSha: string | null
  readonly createdAt: Date | null
}

export function isDesktopShelfBranchName(name: string) {
  return name.startsWith(DesktopShelfBranchPrefix)
}

export function isDesktopShelfBranch(branch: Branch) {
  return isDesktopShelfBranchName(branch.nameWithoutRemote)
}

export function filterOutDesktopShelfBranches(
  branches: ReadonlyArray<Branch>
): ReadonlyArray<Branch> {
  return branches.some(isDesktopShelfBranch)
    ? branches.filter(branch => !isDesktopShelfBranch(branch))
    : branches
}

export function getDesktopShelfDisplayName(branchName: string) {
  if (!isDesktopShelfBranchName(branchName)) {
    return branchName
  }

  const withoutPrefix = branchName.slice(DesktopShelfBranchPrefix.length)
  const lastDashIndex = withoutPrefix.lastIndexOf('-')

  if (lastDashIndex <= 0) {
    return withoutPrefix
  }

  const maybeSuffix = withoutPrefix.slice(lastDashIndex + 1)
  const suffixIsGenerated =
    maybeSuffix.length === 8 &&
    /^[a-z0-9]+$/i.test(maybeSuffix) &&
    withoutPrefix.slice(0, lastDashIndex).includes('-')

  if (!suffixIsGenerated) {
    return withoutPrefix
  }

  const stem = withoutPrefix.slice(0, lastDashIndex)
  const timestampSeparator = stem.lastIndexOf('-')

  if (timestampSeparator <= 0) {
    return stem
  }

  return stem.slice(0, timestampSeparator)
}

export function getDesktopShelfSlug(name: string) {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized.length > 0 ? normalized : 'shelf'
}

export function buildDesktopShelfBranchName(
  name: string,
  now: Date = new Date()
) {
  const suffix = `${now.getTime().toString(36)}-${crypto
    .randomUUID()
    .slice(0, 8)}`

  return `${DesktopShelfBranchPrefix}${getDesktopShelfSlug(name)}-${suffix}`
}

export function parseDesktopShelfMetadata(commit: Commit): IShelfMetadata {
  const trailers = new Map(
    commit.trailers.map(trailer => [trailer.token.toLowerCase(), trailer.value])
  )

  const createdAtValue = trailers.get(DesktopShelfCreatedAtTrailer.toLowerCase())
  const createdAt =
    createdAtValue === undefined ? null : new Date(createdAtValue.trim())

  return {
    name: trailers.get(DesktopShelfNameTrailer.toLowerCase()) ?? null,
    sourceBranchName:
      trailers.get(DesktopShelfSourceBranchTrailer.toLowerCase()) ?? null,
    sourceHeadSha:
      trailers.get(DesktopShelfSourceHeadTrailer.toLowerCase()) ?? null,
    createdAt:
      createdAt !== null && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
  }
}

export function buildDesktopShelfCommitMessage(
  shelfName: string,
  sourceBranchName: string,
  sourceHeadSha: string,
  createdAt: Date
) {
  const lines = [
    `[shelf] ${shelfName}`,
    '',
    `Shelved changes from ${sourceBranchName}.`,
    '',
    `${DesktopShelfNameTrailer}: ${shelfName}`,
    `${DesktopShelfSourceBranchTrailer}: ${sourceBranchName}`,
    `${DesktopShelfSourceHeadTrailer}: ${sourceHeadSha}`,
    `${DesktopShelfCreatedAtTrailer}: ${createdAt.toISOString()}`,
  ]

  return lines.join('\n')
}
