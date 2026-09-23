import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import ApiKeyGate from "@/components/ApiKeyGate";
import ConvexProviderGate from "@/components/ConvexProviderGate";
import Play from "./pages/Play";
import { useEffect } from "react";

const base = import.meta.env.BASE_URL;

function RestorePath() {
  useEffect(() => {
    const redirectPath = sessionStorage.getItem("redirectPath");
    if (redirectPath) {
      window.history.replaceState(null, "", redirectPath);
      sessionStorage.removeItem("redirectPath");
    }
  }, []);
  return null;
}

function PlaygroundRoute() {
  return (
    <ConvexProviderGate>
      <ApiKeyGate>
        {(apiKey, api, openSettings) => (
          <Play apiKey={apiKey} api={api} openSettings={openSettings} />
        )}
      </ApiKeyGate>
    </ConvexProviderGate>
  );
}

const App = () => {
  return (
    <TooltipProvider>
      <RestorePath />
      <Toaster />
      <Sonner />
      <BrowserRouter basename={base}>
        <Routes>
          <Route path="/play/:url" element={<PlaygroundRoute />} />
          <Route path="/play" element={<PlaygroundRoute />} />
          <Route path="/" element={<Index />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  );
};

export default App;
