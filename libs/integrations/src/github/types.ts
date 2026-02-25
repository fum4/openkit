export interface GitHubConfig {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export interface PRInfo {
  url: string;
  number: number;
  state: string;
  isDraft: boolean;
  title: string;
}

export interface GitStatusInfo {
  hasUncommitted: boolean;
  ahead: number;
  behind: number;
  noUpstream: boolean;
  /** Commits ahead of base branch (for PR eligibility) */
  aheadOfBase: number;
}
