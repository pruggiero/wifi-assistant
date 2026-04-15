export type IssueType = 'reboot'; // extend this union to add new issue types

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
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
