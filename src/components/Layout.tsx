/**
 * Layout component - Header, Navigation Tabs, and Footer
 */

interface LayoutProps {
  children: React.ReactNode;
  onExportJSON: () => void;
  onImportJSON: () => void;
  onExportPDF: () => void;
  onExportSnapshotPDF: () => void;
}

export type TabId = 'dashboard' | 'whatif' | 'transactions' | 'movements' | 'income' | 'receivables' | 'timeline' | 'ai-insights';

export function Layout({ children, onExportJSON, onImportJSON, onExportPDF, onExportSnapshotPDF }: LayoutProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>2025 Cash Flow</h1>
        <div className="header-actions">
          <button onClick={onExportJSON} className="btn">
            Export JSON
          </button>
          <button onClick={onExportPDF} className="btn">
            Next 30 Days PDF
          </button>
          <button onClick={onExportSnapshotPDF} className="btn">
            Cash Flow Snapshot PDF
          </button>
          <button onClick={onImportJSON} className="btn btn-outline">
            Import JSON
          </button>
        </div>
      </header>

      {children}

      <footer className="app-footer">
        <small>All data is stored locally in your browser. 💾</small>
      </footer>
    </div>
  );
}

interface TabNavigationProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  const tabs: { id: TabId; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'whatif', label: 'What-If' },
    { id: 'transactions', label: 'All Transactions' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'movements', label: 'Cash Movements' },
    { id: 'income', label: 'Income Plan' },
    { id: 'receivables', label: 'Receivables (AR)' },
    { id: 'ai-insights', label: '🤖 AI Insights' },
  ];

  return (
    <nav className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          data-tab={tab.id}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
