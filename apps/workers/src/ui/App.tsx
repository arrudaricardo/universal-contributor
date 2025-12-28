import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Layout } from "./components/Layout";
import { Dashboard } from "./components/Dashboard";
import { AgentList } from "./components/AgentList";
import { ContributionList } from "./components/ContributionList";
import { RepositoryList } from "./components/RepositoryList";
import { IssueList } from "./components/IssueList";
import { WorkspaceList } from "./components/WorkspaceList";
import type { Page } from "./lib/types";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
});

function getPageFromHash(): Page {
  const hash = window.location.hash.slice(1);
  const validPages: Page[] = ["dashboard", "agents", "contributions", "repositories", "issues", "workspaces"];
  return validPages.includes(hash as Page) ? (hash as Page) : "dashboard";
}

function AppContent() {
  const [currentPage, setCurrentPage] = useState<Page>(getPageFromHash);

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentPage(getPageFromHash());
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const renderPage = () => {
    switch (currentPage) {
      case "dashboard":
        return <Dashboard />;
      case "agents":
        return <AgentList />;
      case "contributions":
        return <ContributionList />;
      case "repositories":
        return <RepositoryList />;
      case "issues":
        return <IssueList />;
      case "workspaces":
        return <WorkspaceList />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <Layout currentPage={currentPage}>
      {renderPage()}
    </Layout>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
