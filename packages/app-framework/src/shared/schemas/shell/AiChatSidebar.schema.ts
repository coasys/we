import type { SchemaNode } from '@we/schema-shared';

/**
 * Shell AI Chat Sidebar
 *
 * Right-side chat panel for conversational AI template editing.
 * Renders the ChatPanel widget connected to the aiStore.
 * Only visible when the user is logged in (boot state === 'ready').
 *
 * Rendered by launcherUIRegistry alongside the boot screen, left sidebar,
 * and active template.
 */
export const aiChatSidebar: SchemaNode = {
  type: '$if',
  props: {
    condition: { $eq: [{ $store: 'adamStore.bootState' }, 'ready'] },
    then: {
      type: 'ChatPanel',
      props: {
        open: { $store: 'aiStore.isOpen' },
        side: 'right',
        width: '400px',
        position: 'fixed',
        zIndex: 20,
        title: 'AI Template Editor',
        placeholder: 'Describe a change to the template...',
        messages: { $store: 'aiStore.messages' },
        loading: { $store: 'aiStore.isStreaming' },
        streamingContent: { $store: 'aiStore.streamingContent' },
        onSend: { $action: 'aiStore.sendMessage' },
        onClose: { $action: 'aiStore.close' },
        apiKeyConfigured: { $store: 'aiStore.apiKeyConfigured' },
        onSetApiKey: { $action: 'aiStore.setApiKey' },

        // Template context header
        templateName: { $store: 'aiStore.templateName' },
        templateIcon: { $store: 'aiStore.templateIcon' },
        isReadOnly: { $store: 'aiStore.isReadOnly' },
        hasPendingChanges: { $store: 'aiStore.hasPendingChanges' },
        onFork: { $action: 'aiStore.startFork' },
        onStartFresh: { $action: 'aiStore.startFresh' },

        // Name + Icon picker
        pickerOpen: { $store: 'aiStore.pickerOpen' },
        pickerAction: { $store: 'aiStore.pickerAction' },
        pickerDefaultName: { $store: 'aiStore.pickerDefaultName' },
        pickerDefaultIcon: { $store: 'aiStore.pickerDefaultIcon' },
        pickerShowDestination: { $store: 'aiStore.pickerShowDestination' },
        onPickerConfirm: { $action: 'aiStore.confirmPicker' },
        onPickerCancel: { $action: 'aiStore.cancelPicker' },

        // Session management
        sessions: { $store: 'aiStore.sessions' },
        activeSessionId: { $store: 'aiStore.activeSessionId' },
        onNewChat: { $action: 'aiStore.newChat' },
        onSwitchSession: { $action: 'aiStore.switchSession' },
        onDeleteSession: { $action: 'aiStore.deleteSession' },

        // Undo / Redo
        canUndo: { $store: 'aiStore.canUndo' },
        canRedo: { $store: 'aiStore.canRedo' },
        onUndo: { $action: 'aiStore.undo' },
        onRedo: { $action: 'aiStore.redo' },

        // Operation loading
        operationLoading: { $store: 'templateStore.operationLoading' },
      },
    },
  },
};
