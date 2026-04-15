/**
 * Chat message displayed in the panel
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  status?: 'sending' | 'streaming' | 'sent' | 'error';
  messageType?: 'text' | 'success' | 'error' | 'info';
  thinking?: string;
}

/**
 * Summary of a chat session for the session list
 */
export interface SessionInfo {
  id: string;
  name: string;
  updatedAt: string;
}

/**
 * @ai Sliding chat panel for conversational AI interactions.
 * Renders a list of messages with a text input, anchored to a screen edge.
 * Supports streaming indicator, auto-scroll, and header/close controls.
 * Includes template context header with fork/fresh actions and name+icon picker.
 */
export interface ChatPanelProps {
  // Panel state
  open: boolean;
  side?: 'left' | 'right';
  width?: string;
  position?: 'fixed' | 'absolute';
  zIndex?: number;

  // Messages
  messages: ChatMessage[];
  loading?: boolean;
  streamingContent?: string;

  // Input
  placeholder?: string;
  onSend: (message: string) => void;
  disabled?: boolean;

  // Header
  title?: string;
  onClose?: () => void;

  // API key
  apiKeyConfigured?: boolean;
  onSetApiKey?: (key: string) => void;

  // Template context header
  templateName?: string;
  templateIcon?: string;
  isReadOnly?: boolean;
  hasPendingChanges?: boolean;
  onFork?: () => void;
  onStartFresh?: () => void;

  // Name + Icon picker (fork or fresh)
  pickerOpen?: boolean;
  pickerAction?: 'fork' | 'fresh';
  pickerDefaultName?: string;
  pickerDefaultIcon?: string;
  onPickerConfirm?: (name: string, icon: string) => void;
  onPickerCancel?: () => void;

  // Panel mode: chat or code (JSON viewer)
  mode?: 'chat' | 'code';
  schemaJson?: string;
  onModeChange?: (mode: 'chat' | 'code') => void;
  onSchemaEdit?: (json: string) => void;

  // Session management
  sessions?: SessionInfo[];
  activeSessionId?: string | null;
  onNewChat?: () => void;
  onSwitchSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;

  // Operation loading
  operationLoading?: string | null;
}
