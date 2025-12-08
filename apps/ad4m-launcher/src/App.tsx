import AiInterface from '@/components/AiInterface';
import AppSettings from '@/components/AppSettings';
import { Splashscreen } from '@/components/Splashscreen';
import StoreProvider from '@/providers/StoreProvider';
import TemplateProvider from '@/providers/TemplateProvider';
import { useAdamStore } from '@/stores/AdamStore';

export default function App() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}

function AppContent() {
  const { loading } = useAdamStore();

  return (
    <>
      <Splashscreen show={loading()} />
      <AppSettings />
      <AiInterface />
      <TemplateProvider />
    </>
  );
}
