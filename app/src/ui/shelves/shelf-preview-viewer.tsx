import * as React from 'react'

import { Repository } from '../../models/repository'
import { IShelf } from '../../models/shelf'
import { CommittedFileChange } from '../../models/status'
import { IDiff, ImageDiffType } from '../../models/diff'
import { IConstrainedValue } from '../../lib/app-state'
import { clamp } from '../../lib/clamp'
import { Dispatcher } from '../dispatcher'
import { FileList } from '../history/file-list'
import { Resizable } from '../resizable'
import { SeamlessDiffSwitcher } from '../diff/seamless-diff-switcher'
import { Button } from '../lib/button'

interface IShelfPreviewViewerProps {
  readonly shelf: IShelf
  readonly files: ReadonlyArray<CommittedFileChange>
  readonly isLoadingFiles: boolean
  readonly selectedShelfFile: CommittedFileChange | null
  readonly shelfFileDiff: IDiff | null
  readonly imageDiffType: ImageDiffType
  readonly fileListWidth: IConstrainedValue
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly showSideBySideDiff: boolean
  readonly onOpenBinaryFile: (fullPath: string) => void
  readonly onChangeImageDiffType: (type: ImageDiffType) => void
  readonly onHideWhitespaceInDiffChanged: (checked: boolean) => void
  readonly onOpenSubmodule: (fullPath: string) => void
  readonly onOpenInExternalEditor: (path: string) => void
}

export const ShelfPreviewViewerId = 'shelf-preview-viewer'

export class ShelfPreviewViewer extends React.PureComponent<IShelfPreviewViewerProps> {
  private onSelectedFileChanged = (file: CommittedFileChange) =>
    this.props.dispatcher.selectShelfFile(
      this.props.repository,
      this.props.shelf,
      file
    )

  private onRowDoubleClick = (row: number) => {
    const file = this.props.files[row]
    this.props.onOpenInExternalEditor(file.path)
  }

  private onResize = (width: number) =>
    this.props.dispatcher.setStashedFilesWidth(width)

  private onReset = () => this.props.dispatcher.resetStashedFilesWidth()

  private onBack = () => this.props.dispatcher.hideShelfPreview(this.props.repository)

  public render() {
    const {
      shelf,
      files,
      isLoadingFiles,
      selectedShelfFile,
      shelfFileDiff,
      repository,
      imageDiffType,
      fileListWidth,
      onOpenBinaryFile,
      onChangeImageDiffType,
      onOpenSubmodule,
    } = this.props

    const diffComponent =
      selectedShelfFile !== null ? (
        <SeamlessDiffSwitcher
          repository={repository}
          readOnly={true}
          file={selectedShelfFile}
          diff={shelfFileDiff}
          imageDiffType={imageDiffType}
          hideWhitespaceInDiff={false}
          showDiffCheckMarks={false}
          showSideBySideDiff={this.props.showSideBySideDiff}
          onOpenBinaryFile={onOpenBinaryFile}
          onChangeImageDiffType={onChangeImageDiffType}
          onHideWhitespaceInDiffChanged={
            this.props.onHideWhitespaceInDiffChanged
          }
          onOpenSubmodule={onOpenSubmodule}
        />
      ) : null

    const availableWidth = clamp(fileListWidth)
    const branchLabel =
      shelf.sourceBranchName === null
        ? 'Created from an unknown branch'
        : `Created from ${shelf.sourceBranchName}`

    return (
      <section id={ShelfPreviewViewerId}>
        <div className="header">
          <div className="shelf-preview-title-row">
            <div className="shelf-preview-title">
              <h3>{shelf.name}</h3>
              <div className="shelf-preview-meta">
                {isLoadingFiles
                  ? `${branchLabel} - Loading changed files...`
                  : `${branchLabel} - ${files.length} changed ${
                      files.length === 1 ? 'file' : 'files'
                    }`}
              </div>
            </div>
            <Button onClick={this.onBack}>Back to changes</Button>
          </div>
          <div className="explanatory-text">
            <span className="text">
              This preview compares the shelf commit with its parent. It does
              not change your current branch or working directory.
            </span>
          </div>
        </div>
        <div className="commit-details">
          <Resizable
            width={fileListWidth.value}
            minimumWidth={fileListWidth.min}
            maximumWidth={fileListWidth.max}
            onResize={this.onResize}
            onReset={this.onReset}
            description="Shelf file list"
          >
            <FileList
              files={files}
              onSelectedFileChanged={this.onSelectedFileChanged}
              selectedFile={selectedShelfFile}
              availableWidth={availableWidth}
              onRowDoubleClick={this.onRowDoubleClick}
            />
          </Resizable>
          {isLoadingFiles ? (
            <div className="shelf-preview-loading">Loading shelf changes...</div>
          ) : (
            diffComponent
          )}
        </div>
      </section>
    )
  }
}
