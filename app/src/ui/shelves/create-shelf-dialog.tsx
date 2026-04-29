import * as React from 'react'

import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import {
  Dialog,
  DialogContent,
  DialogError,
  DialogFooter,
  DialogWarning,
} from '../dialog'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { TextBox } from '../lib/text-box'
import { Checkbox, CheckboxValue } from '../lib/checkbox'

interface ICreateShelfDialogProps {
  readonly dispatcher: Dispatcher
  readonly repository: Repository
  readonly paths: ReadonlyArray<string>
  readonly onDismissed: () => void
}

interface ICreateShelfDialogState {
  readonly name: string
  readonly publish: boolean
  readonly creating: boolean
  readonly created: boolean
  readonly warning: string | null
  readonly error: string | null
}

export class CreateShelfDialog extends React.Component<
  ICreateShelfDialogProps,
  ICreateShelfDialogState
> {
  public constructor(props: ICreateShelfDialogProps) {
    super(props)

    this.state = {
      name: '',
      publish: false,
      creating: false,
      created: false,
      warning: null,
      error: null,
    }
  }

  public render() {
    const fileCount = this.props.paths.length
    const previewPaths = this.props.paths.slice(0, 8)
    const remainingPathCount = this.props.paths.length - previewPaths.length

    return (
      <Dialog
        id="create-shelf"
        title={__DARWIN__ ? 'Create Shelf' : 'Create shelf'}
        onDismissed={this.props.onDismissed}
        onSubmit={this.onSubmit}
        loading={this.state.creating}
        dismissDisabled={this.state.creating}
        disabled={this.state.creating}
        type={this.state.warning === null ? 'normal' : 'warning'}
      >
        {this.state.warning !== null ? (
          <DialogWarning>{this.state.warning}</DialogWarning>
        ) : null}

        <DialogContent>
          {this.state.created ? (
            <p>The shelf was created.</p>
          ) : (
            <>
              <p>
                Create a named shelf from the {fileCount}{' '}
                {fileCount === 1 ? 'selected file' : 'selected files'} listed
                below and remove only those changes from the current branch.
              </p>

              <ul>
                {previewPaths.map(path => (
                  <li key={path}>
                    <code>{path}</code>
                  </li>
                ))}
                {remainingPathCount > 0 ? (
                  <li>
                    ...and {remainingPathCount} more{' '}
                    {remainingPathCount === 1 ? 'file' : 'files'}
                  </li>
                ) : null}
              </ul>

              <p>
                <TextBox
                  ariaLabel="Shelf name"
                  value={this.state.name}
                  placeholder="Shelf name"
                  onValueChanged={this.onNameChanged}
                />
              </p>

              <Checkbox
                value={this.state.publish ? CheckboxValue.On : CheckboxValue.Off}
                onChange={this.onPublishChanged}
                label="Push this shelf online after creating it"
              />
            </>
          )}

          {this.state.error !== null ? (
            <DialogError>{this.state.error}</DialogError>
          ) : null}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={this.state.created ? 'Close' : 'Create Shelf'}
            okButtonDisabled={
              this.state.creating ||
              (!this.state.created && this.state.name.trim().length === 0)
            }
            cancelButtonVisible={!this.state.created}
            cancelButtonDisabled={this.state.creating}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onNameChanged = (name: string) => {
    this.setState({ name, error: null })
  }

  private onPublishChanged = () => {
    this.setState(state => ({ publish: !state.publish }))
  }

  private onSubmit = async () => {
    if (this.state.created) {
      this.props.onDismissed()
      return
    }

    this.setState({ creating: true, error: null })

    try {
      const result = await this.props.dispatcher.createShelf(
        this.props.repository,
        this.props.paths,
        this.state.name.trim(),
        this.state.publish
      )

      if (result.cleanupWarning !== null) {
        this.setState({
          creating: false,
          created: true,
          warning: result.cleanupWarning,
        })
        return
      }

      this.props.onDismissed()
    } catch (error) {
      this.setState({
        creating: false,
        error: error instanceof Error ? error.message : `${error}`,
      })
    }
  }
}
