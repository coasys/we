import StoreProvider from '@/providers/StoreProvider';
import TemplateProvider from '@/providers/TemplateProvider';

export default function App() {
  return (
    <StoreProvider>
      <TemplateProvider />
    </StoreProvider>
  );
}
