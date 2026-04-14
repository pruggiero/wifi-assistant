export interface ConversationState {
  phase: 'qualifying' | 'reboot' | 'resolution' | 'closed';
  rebootGroupIndex: number;
}

export const INITIAL_STATE: ConversationState = {
  phase: 'qualifying',
  rebootGroupIndex: 0,
};
