import * as React from 'react'

import { Repository } from '../../models/repository'
import { IShelf } from '../../models/shelf'
import { Dispatcher } from '../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { Ref } from '../lib/ref'

interface IDeleteShelfDialogProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly shelf: IShelf
  readonly onDismissed: () => void
}

interface IDeleteShelfDialogState {
  readonly isDeleting: boolean
}

export class DeleteShelfDialog extends React.Component<
  IDeleteShelfDialogProps,
  IDeleteShelfDialogState
> {
  public constructor(props: IDeleteShelfDialogProps) {
    super(props)

    this.state = {
      isDeleting: false,
    }
  }

  public render() {
    const remoteDescription = this.getRemoteDescription()

    return (
      <Dialog
        id="delete-shelf"
        title={__DARWIN__ ? 'Delete Shelf' : 'Delete shelf'}
        type="warning"
        onSubmit={this.onDeleteShelf}
        onDismissed={this.props.onDismissed}
        disabled={this.state.isDeleting}
        loading={this.state.isDeleting}
        role="alertdialog"
        ariaDescribedBy="delete-shelf-confirmation-message delete-shelf-confirmation-remote"
      >
        <DialogContent>
          <div id="delete-shelf-confirmation-message">
            <p>
              Delete shelf <Ref>{this.props.shelf.name}</Ref>?
            </p>
            <p>This action cannot be undone.</p>
          </div>

          {remoteDescription === null ? null : (
            <p id="delete-shelf-confirmation-remote">{remoteDescription}</p>
          )}
        </DialogContent>
        <DialogFooter>
          <OkCancelButtonGroup destructive={true} okButtonText="Delete" />
        </DialogFooter>
      </Dialog>
    )
  }

  private getRemoteDescription() {
    const { shelf } = this.props

    if (shelf.localRef !== null && shelf.remoteName !== null) {
      return `The published shelf branch on ${shelf.remoteName} will also be deleted.`
    }

    if (shelf.isRemoteOnly && shelf.remoteName !== null) {
      return `The remote-only shelf branch on ${shelf.remoteName} will be deleted.`
    }

    return null
  }

  private onDeleteShelf = async () => {
    this.setState({ isDeleting: true })

    await this.props.dispatcher.deleteShelf(
      this.props.repository,
      this.props.shelf
    )

    this.props.onDismissed()
  }
}
