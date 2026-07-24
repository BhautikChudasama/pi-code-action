export interface Repository {
  owner: string;
  repo: string;
  default_branch?: string;
}

export interface ActionInputs {
  prompt?: string;
  triggerPhrase: string;
  assigneeTrigger?: string;
  labelTrigger?: string;
  baseBranch?: string;
  branchPrefix: string;
  allowedBots: string;
  useStickyComment: boolean;
  botId: string;
  botName: string;
  trackProgress: boolean;
  piProvider: string;
  piModel: string;
  piThinkingLevel: string;
  piTools?: string;
  piExtensions?: string;
  piMaxCost?: number;
  piMaxTurns?: number;
}

export interface EntityContext {
  kind: "entity";
  eventName: string;
  eventAction?: string;
  actor: string;
  repository: Repository;
  inputs: ActionInputs;
  isPR: boolean;
  entityNumber: number;
  issue?: IssuePayload;
  pullRequest?: PullRequestPayload;
  comment?: CommentPayload;
  payload: Record<string, unknown>;
}

export interface GenericContext {
  kind: "generic";
  eventName: string;
  eventAction?: string;
  actor: string;
  repository: Repository;
  inputs: ActionInputs;
  payload: Record<string, unknown>;
}

export type GitHubContext = EntityContext | GenericContext;

export interface IssuePayload {
  number: number;
  title: string;
  body: string | null;
  user: { login: string };
  labels: Array<{ name: string }>;
  assignees: Array<{ login: string }>;
  state: string;
}

export interface PullRequestPayload {
  number: number;
  title: string;
  body: string | null;
  user: { login: string };
  head: { ref: string; sha: string };
  base: { ref: string };
  labels: Array<{ name: string }>;
  state: string;
  draft: boolean;
}

export interface CommentPayload {
  id: number;
  body: string;
  user: { login: string };
  created_at: string;
}

export interface BranchInfo {
  baseBranch: string;
  claudeBranch?: string;
  currentBranch: string;
}

export interface PrepareResult {
  commentId?: number;
  branchInfo: BranchInfo;
  piArgs: string;
}

export interface GitHubData {
  issueOrPrNumber: number;
  isPR: boolean;
  title: string;
  body: string | null;
  comments: Array<{
    author: string;
    body: string;
    createdAt: string;
  }>;
  diff?: string;
  labels: string[];
  baseBranch?: string;
  headBranch?: string;
}
