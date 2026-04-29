import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

/**
 * A component used for displaying short warning messages inline in a dialog.
 */
export class DialogWarning extends React.Component {
  public render() {
    return (
      <div className="dialog-banner dialog-warning" role="alert">
        <Octicon symbol={octicons.alert} />
        <div>{this.props.children}</div>
      </div>
    )
  }
}
