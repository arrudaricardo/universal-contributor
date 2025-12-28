import type { ReactNode } from "react";
import type { Page } from "../lib/types";
import { useState } from "react";
import { ConfigPanel } from "./ConfigPanel";
import { 
  LayoutDashboard, 
  Monitor, 
  Database, 
  GitPullRequest, 
  FolderGit2, 
  CircleDot,
  Settings,
  Zap
} from "lucide-react";

interface LayoutProps {
  currentPage: Page;
  children: ReactNode;
}

const navItems: { page: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { page: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { page: "agents", label: "Agents", icon: Monitor },
  { page: "workspaces", label: "Workspaces", icon: Database },
  { page: "contributions", label: "Pull Requests", icon: GitPullRequest },
  { page: "repositories", label: "Repositories", icon: FolderGit2 },
  { page: "issues", label: "Issues", icon: CircleDot },
];

export function Layout({ currentPage, children }: LayoutProps) {
  const [showConfig, setShowConfig] = useState(false);

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Sidebar */}
      <aside className="w-56 bg-white/80 backdrop-blur-xl border-r border-slate-200/60 flex flex-col shadow-xl">
        {/* Logo */}
        <div className="p-4 border-b border-slate-200/60">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-500/25">
              <Zap className="w-3.5 h-3.5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900">Universal</h1>
              <p className="text-xs text-slate-500 -mt-0.5">Contributor</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 overflow-y-auto">
          <ul className="space-y-0.5">
            {navItems.map(({ page, label, icon: Icon }) => (
              <li key={page}>
                <a
                  href={`#${page}`}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                    currentPage === page
                      ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-sm shadow-indigo-500/25"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Footer */}
        <div className="p-2 border-t border-slate-200/60">
          <button
            onClick={() => setShowConfig(true)}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-lg transition-all duration-200"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* Config modal */}
      {showConfig && <ConfigPanel onClose={() => setShowConfig(false)} />}
    </div>
  );
}
