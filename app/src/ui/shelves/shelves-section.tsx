import * as React from 'react'
import classNames from 'classnames'

import { Repository } from '../../models/repository'
import { IShelf, IShelfActionProgress } from '../../models/shelf'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { getBoolean, setBoolean } from '../../lib/local-storage'
import { ShelfPreviewViewerId } from './shelf-preview-viewer'

const shelvesCollapsedKey = 'shelves-section-collapsed'

interface IShelvesSectionProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly shelves: ReadonlyArray<IShelf>
  readonly shelfActionInProgress: IShelfActionProgress | null
  readonly canUnshelve: boolean
  readonly isBusy: boolean
  readonly selectedShelfId: string | null
}

interface IShelvesSectionState {
  readonly isCollapsed: boolean
}

export class ShelvesSection extends React.Component<
  IShelvesSectionProps,
  IShelvesSectionState
> {
  public constructor(props: IShelvesSectionProps) {
    super(props)

    this.state = { isCollapsed: getBoolean(shelvesCollapsedKey, false) }
  }

  public render() {
    if (this.props.shelves.length === 0) {
      return null
    }

    const isSectionBusy =
      this.props.isBusy || this.props.shelfActionInProgress !== null

    return (
      <div
        className={classNames('desktop-shelves-section', {
          'desktop-shelves-section--busy': isSectionBusy,
          'desktop-shelves-section--collapsed': this.state.isCollapsed,
        })}
        aria-busy={isSectionBusy}
      >
        <button
          type="button"
          className="desktop-shelves-header"
          onClick={this.onToggleCollapsed}
          aria-expanded={!this.state.isCollapsed}
        >
          <div className="desktop-shelves-heading">
            <Octicon
              symbol={
                this.state.isCollapsed ? octicons.chevronRight : octicons.chevronDown
              }
            />
            <span className="desktop-shelves-title">Shelves</span>
          </div>
          <div className="desktop-shelves-count">{this.props.shelves.length}</div>
        </button>

        {this.state.isCollapsed ? null : (
          <div className="desktop-shelves-list">
            {this.props.shelves.map(shelf => this.renderShelf(shelf))}
          </div>
        )}
      </div>
    )
  }

  private onToggleCollapsed = () => {
    this.setState(state => {
      const isCollapsed = !state.isCollapsed
      setBoolean(shelvesCollapsedKey, isCollapsed)
      return { isCollapsed }
    })
  }

  private renderShelf(shelf: IShelf) {
    const actionsDisabled =
      this.props.isBusy || this.props.shelfActionInProgress !== null

    const branchLabel =
      shelf.sourceBranchName === null
        ? 'Created from an unknown branch'
        : `From ${shelf.sourceBranchName}`

    return (
      <div
        className={classNames('desktop-shelf-row', {
          'desktop-shelf-row--selected': this.props.selectedShelfId === shelf.id,
        })}
        key={shelf.id}
      >
        <div className="desktop-shelf-details">
          <div className="desktop-shelf-name">{shelf.name}</div>
          <div className="desktop-shelf-meta">
            <span>{branchLabel}</span>
            <span>{shelf.isPublished ? 'Published' : 'Local only'}</span>
            {shelf.isRemoteOnly ? <span>Remote only</span> : null}
          </div>
        </div>

        <div
          className={classNames('desktop-shelf-actions', {
            'desktop-shelf-actions--disabled': actionsDisabled,
          })}
        >
          <Button
            className="desktop-shelf-action"
            size="small"
            onClick={this.onViewClicked(shelf)}
            ariaExpanded={this.props.selectedShelfId === shelf.id}
            ariaControls={
              this.props.selectedShelfId === shelf.id
                ? ShelfPreviewViewerId
                : undefined
            }
          >
            View
          </Button>
          <Button
            className="desktop-shelf-action"
            size="small"
            onClick={this.onUnshelveClicked(shelf)}
            disabled={!this.props.canUnshelve || actionsDisabled}
          >
            Unshelve
          </Button>
          {!shelf.isPublished && !shelf.isRemoteOnly ? (
            <Button
              className="desktop-shelf-action"
              size="small"
              disabled={actionsDisabled}
              onClick={this.onPublishClicked(shelf)}
            >
              Publish
            </Button>
          ) : null}
          <Button
            className="desktop-shelf-action desktop-shelf-delete-button"
            size="small"
            disabled={actionsDisabled}
            onClick={this.onDeleteClicked(shelf)}
          >
            Delete
          </Button>
        </div>
      </div>
    )
  }

  private onViewClicked =
    (shelf: IShelf) => async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()

      await this.props.dispatcher.selectShelfFile(this.props.repository, shelf)
    }

  private onUnshelveClicked =
    (shelf: IShelf) => async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()

      if (this.props.shelfActionInProgress !== null) {
        return
      }

      await this.props.dispatcher.unshelveShelf(this.props.repository, shelf)
    }

  private onPublishClicked =
    (shelf: IShelf) => async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()

      if (this.props.shelfActionInProgress !== null) {
        return
      }

      await this.props.dispatcher.publishShelf(
        this.props.repository,
        shelf.branchName,
        shelf.remoteName ?? undefined,
        shelf.id
      )
    }

  private onDeleteClicked =
    (shelf: IShelf) => async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()

      await this.props.dispatcher.showDeleteShelfDialog(
        this.props.repository,
        shelf
      )
    }
}
