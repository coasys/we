import { Accessor, createContext, createSignal, ParentProps, useContext } from 'solid-js';

export type ModalName = 'app-settings' | 'create-space';

export interface ModalStore {
  // State
  appSettingsModalOpen?: Accessor<boolean>;
  createSpaceModalOpen: Accessor<boolean>;

  // Actions
  openModal: (modalName: ModalName) => void;
  closeModal: (modalName: ModalName) => void;
}

const ModalContext = createContext<ModalStore>();

export function ModalStoreProvider(props: ParentProps) {
  // State
  const [appSettingsModalOpen, setAppSettingsModalOpen] = createSignal(false);
  const [createSpaceModalOpen, setCreateSpaceModalOpen] = createSignal(false);

  // Actions
  function openModal(modalName: ModalName) {
    if (modalName === 'app-settings') setAppSettingsModalOpen(true);
    if (modalName === 'create-space') setCreateSpaceModalOpen(true);
  }

  function closeModal(modalName: ModalName) {
    if (modalName === 'app-settings') setAppSettingsModalOpen(false);
    if (modalName === 'create-space') setCreateSpaceModalOpen(false);
  }

  const store: ModalStore = {
    // State
    appSettingsModalOpen,
    createSpaceModalOpen,

    // Actions
    openModal,
    closeModal,
  };

  return <ModalContext.Provider value={store}>{props.children}</ModalContext.Provider>;
}

export function useModalStore(): ModalStore {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModalStore must be used within ModalProvider');
  return ctx;
}

export default ModalStoreProvider;
