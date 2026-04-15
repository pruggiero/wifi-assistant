export type IssueType = 'reboot'; // extend this union to add new issue types

// waitForUser=false steps are presented without pausing; waitForUser=true steps wait for the user to confirm before advancing.
export interface Step {
  message: string;
  waitForUser: boolean;
}

export interface ConversationState {
  phase: 'qualifying' | 'guided-steps' | 'resolution' | 'closed';
  issueType: IssueType | null;
  stepIndex: number;
}

export const INITIAL_CONVERSATION_STATE: ConversationState = {
  phase: 'qualifying',
  issueType: null,
  stepIndex: 0,
};

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}
