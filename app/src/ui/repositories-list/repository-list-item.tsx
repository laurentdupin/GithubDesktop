import * as React from 'react'

import { Repository } from '../../models/repository'
import { Octicon, iconForRepository } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Repositoryish } from './group-repositories'
import { HighlightText } from '../lib/highlight-text'
import { IMatches } from '../../lib/fuzzy-find'
import { IAheadBehind } from '../../models/branch'
import classNames from 'classnames'
import { createObservableRef } from '../lib/observable-ref'
import { Tooltip } from '../lib/tooltip'
import { enableAccessibleListToolTips } from '../../lib/feature-flag'
import { TooltippedContent } from '../lib/tooltipped-content'
import { formatRepositoryDisplayName } from '../../lib/repository-display-name'

interface IRepositoryListItemProps {
  readonly repository: Repositoryish

  /** The characters in the repository name to highlight */
  readonly matches: IMatches

  /** Number of commits this local repo branch is behind or ahead of its remote branch */
  readonly aheadBehind: IAheadBehind | null

  /** The current branch name for the repository, if known. */
  readonly currentBranch: string | null

  /** Number of uncommitted changes */
  readonly changedFilesCount: number

  /** Whether the repository is pinned in the switcher. */
  readonly isPinned: boolean

  /** Called when the repository pin state should change. */
  readonly onSetPinned?: (repository: Repository, pinned: boolean) => void
}

/** A repository item. */
export class RepositoryListItem extends React.Component<
  IRepositoryListItemProps,
  {}
> {
  private readonly listItemRef = createObservableRef<HTMLDivElement>()

  public render() {
    const repository = this.props.repository
    const hasChanges = this.props.changedFilesCount > 0
    const title = formatRepositoryDisplayName(
      repository,
      this.props.currentBranch
    )

    return (
      <div className="repository-list-item" ref={this.listItemRef}>
        <Tooltip
          target={this.listItemRef}
          disabled={enableAccessibleListToolTips()}
        >
          {this.renderTooltip()}
        </Tooltip>

        {repository instanceof Repository && (
          <button
            type="button"
            className={classNames('pin-repository-button', {
              pinned: this.props.isPinned,
            })}
            aria-label={
              this.props.isPinned ? 'Unpin repository' : 'Pin repository'
            }
            onMouseDown={this.onPinButtonMouseDown}
            onClick={this.onPinButtonClick}
          >
            <Octicon symbol={octicons.pin} />
          </button>
        )}

        <Octicon
          className="icon-for-repository"
          symbol={iconForRepository(repository)}
        />

        <div className={classNames('name')}>
          <HighlightText text={title} highlight={this.props.matches.title} />
        </div>

        {repository instanceof Repository &&
          renderRepoIndicators({
            aheadBehind: this.props.aheadBehind,
            hasChanges: hasChanges,
          })}
      </div>
    )
  }

  private renderTooltip() {
    const repo = this.props.repository
    const title = formatRepositoryDisplayName(repo, this.props.currentBranch)

    return (
      <>
        <div>
          <strong>{title}</strong>
        </div>
        <div>{repo.path}</div>
      </>
    )
  }

  public shouldComponentUpdate(nextProps: IRepositoryListItemProps): boolean {
    return (
      nextProps.repository !== this.props.repository ||
      nextProps.matches !== this.props.matches ||
      nextProps.currentBranch !== this.props.currentBranch ||
      nextProps.isPinned !== this.props.isPinned ||
      nextProps.changedFilesCount !== this.props.changedFilesCount ||
      !aheadBehindEquals(nextProps.aheadBehind, this.props.aheadBehind)
    )
  }

  private onPinButtonMouseDown = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault()
    event.stopPropagation()
  }

  private onPinButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()

    const { repository, onSetPinned } = this.props
    if (!(repository instanceof Repository) || onSetPinned === undefined) {
      return
    }

    onSetPinned(repository, !this.props.isPinned)
  }
}

const aheadBehindEquals = (
  a: IAheadBehind | null,
  b: IAheadBehind | null
) => {
  if (a === b) {
    return true
  }

  if (a === null || b === null) {
    return false
  }

  return a.ahead === b.ahead && a.behind === b.behind
}

const renderRepoIndicators: React.FunctionComponent<{
  aheadBehind: IAheadBehind | null
  hasChanges: boolean
}> = props => {
  return (
    <div className="repo-indicators">
      {props.aheadBehind && renderAheadBehindIndicator(props.aheadBehind)}
      {props.hasChanges && renderChangesIndicator()}
    </div>
  )
}

const renderAheadBehindIndicator = (aheadBehind: IAheadBehind) => {
  const { ahead, behind } = aheadBehind
  if (ahead === 0 && behind === 0) {
    return null
  }

  const aheadBehindTooltip =
    'The currently checked out branch is' +
    (behind ? ` ${commitGrammar(behind)} behind ` : '') +
    (behind && ahead ? 'and' : '') +
    (ahead ? ` ${commitGrammar(ahead)} ahead of ` : '') +
    'its tracked branch.'

  return (
    <TooltippedContent
      className="ahead-behind"
      tagName="div"
      tooltip={aheadBehindTooltip}
      disabled={enableAccessibleListToolTips()}
    >
      {ahead > 0 && <Octicon symbol={octicons.arrowUp} />}
      {behind > 0 && <Octicon symbol={octicons.arrowDown} />}
    </TooltippedContent>
  )
}

const renderChangesIndicator = () => {
  return (
    <TooltippedContent
      className="change-indicator-wrapper"
      tooltip="There are uncommitted changes in this repository"
      disabled={enableAccessibleListToolTips()}
    >
      <Octicon symbol={octicons.dotFill} />
    </TooltippedContent>
  )
}

export const commitGrammar = (commitNum: number) =>
  `${commitNum} commit${commitNum > 1 ? 's' : ''}` // english is hard
