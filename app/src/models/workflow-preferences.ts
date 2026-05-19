export enum ForkContributionTarget {
  Parent = 'parent',
  Self = 'self',
}

/**
 * Collection of configurable settings regarding how the user may work with a repository.
 */
export type WorkflowPreferences = {
  /**
   * What repo does the user want to contribute to with this fork?
   */
  readonly forkContributionTarget?: ForkContributionTarget

  /**
   * Whether Desktop should inspect submodule working trees when refreshing the
   * parent repository changes list.
   */
  readonly trackSubmoduleWorkingTreeChanges?: boolean
}

export function getTrackSubmoduleWorkingTreeChanges(
  workflowPreferences: WorkflowPreferences
): boolean {
  return workflowPreferences.trackSubmoduleWorkingTreeChanges !== false
}
