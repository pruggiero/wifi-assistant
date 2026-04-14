export type IssueType = 'reboot'; // extend this union to add new issue types

/**
 * A single troubleshooting step. Used by all issue types.
 * Steps with waitForUser=false are presented automatically; steps with waitForUser=true
 * require the user to confirm before the flow advances.
 */
export interface Step {
  id: number;
  message: string;
  waitForUser: boolean;
}

export interface ConversationState {
  phase: 'qualifying' | 'guided-steps' | 'resolution' | 'closed';
  issueType: IssueType | null;
  stepIndex: number;
}

export const INITIAL_STATE: ConversationState = {
  phase: 'qualifying',
  issueType: null,
  stepIndex: 0,
};

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}
