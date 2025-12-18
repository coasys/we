import StoreProvider from '@solid/providers/StoreProvider';
import TemplateProvider from '@solid/providers/TemplateProvider';

export default function App() {
  return (
    <StoreProvider>
      <TemplateProvider />
    </StoreProvider>
  );
}
