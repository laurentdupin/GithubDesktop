import * as React from 'react'
import classNames from 'classnames'

import { Repository } from '../../models/repository'
import { IShelf, IShelfActionProgress } from '../../models/shelf'
import { Dispatcher } from '../dispatcher'
import { Button } from '../lib/button'

interface IShelvesSectionProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly shelves: ReadonlyArray<IShelf>
  readonly shelfActionInProgress: IShelfActionProgress | null
  readonly canUnshelve: boolean
  readonly isBusy: boolean
}

export class ShelvesSection extends React.Component<IShelvesSectionProps> {

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
        })}
        aria-busy={isSectionBusy}
      >
        <div className="desktop-shelves-header">
          <div className="desktop-shelves-title">Shelves</div>
          <div className="desktop-shelves-count">{this.props.shelves.length}</div>
        </div>

        <div className="desktop-shelves-list">
          {this.props.shelves.map(shelf => this.renderShelf(shelf))}
        </div>
      </div>
    )
  }

  private renderShelf(shelf: IShelf) {
    const actionsDisabled =
      this.props.isBusy || this.props.shelfActionInProgress !== null

    const branchLabel =
      shelf.sourceBranchName === null
        ? 'Created from an unknown branch'
        : `From ${shelf.sourceBranchName}`

    return (
      <div className="desktop-shelf-row" key={shelf.id}>
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
            onClick={() =>
              this.props.dispatcher.showDeleteShelfDialog(
                this.props.repository,
                shelf
              )
            }
          >
            Delete
          </Button>
        </div>
      </div>
    )
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
}
