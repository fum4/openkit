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
