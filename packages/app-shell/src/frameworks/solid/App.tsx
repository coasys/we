import StoreProvider from '@solid/providers/StoreProvider';
import TemplateProvider from '@solid/providers/TemplateProvider';
import { ToastContainer } from '@we/components/solid';

import { injectDSInteropStyles } from './dsInterop';

injectDSInteropStyles();

export default function App() {
  return (
    <StoreProvider>
      <TemplateProvider />
      <ToastContainer />
    </StoreProvider>
  );
}
