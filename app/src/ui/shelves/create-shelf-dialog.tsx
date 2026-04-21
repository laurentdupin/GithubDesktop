import * as React from 'react'

import { Dispatcher } from '../dispatcher'
import { Repository } from '../../models/repository'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../dialog'
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
      >
        <DialogContent>
          <p>
            Create a named shelf from the {fileCount}{' '}
            {fileCount === 1 ? 'selected file' : 'selected files'} listed below
            and remove only those changes from the current branch.
          </p>

          <ul>
            {previewPaths.map(path => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
            {remainingPathCount > 0 ? (
              <li>
                …and {remainingPathCount} more{' '}
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

          {this.state.error !== null ? (
            <DialogError>{this.state.error}</DialogError>
          ) : null}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Create Shelf"
            okButtonDisabled={
              this.state.creating || this.state.name.trim().length === 0
            }
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
    this.setState({ creating: true, error: null })

    try {
      await this.props.dispatcher.createShelf(
        this.props.repository,
        this.props.paths,
        this.state.name.trim(),
        this.state.publish
      )

      this.props.onDismissed()
    } catch (error) {
      this.setState({
        creating: false,
        error: error instanceof Error ? error.message : `${error}`,
      })
    }
  }
}
