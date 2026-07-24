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
  /** For PR review comments: the file path */
  path?: string;
  /** For PR review comments: the line number */
  line?: number;
  /** For PR review comments: the diff context */
  diff_hunk?: string;
  /** For PR review comments: parent comment ID (when replying to a thread) */
  in_reply_to_id?: number;
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
  isPullRequestReviewComment?: boolean;
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
