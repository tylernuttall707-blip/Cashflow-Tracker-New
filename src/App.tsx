/**
 * Main App Component
 */

import { useState } from 'react';
import { useAppStore } from './store/useAppStore';
import {
  Layout,
  TabNavigation,
  Dashboard,
  WhatIf,
  CashMovements,
  IncomePlan,
  Receivables,
  AllTransactions,
  AIInsights,
  type TabId,
} from './components';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const { importData, settings, adjustments, oneOffs, incomeStreams, expandedTransactions } = useAppStore();

  const handleExportJSON = () => {
    const data = {
      settings,
      adjustments,
      oneOffs,
      incomeStreams,
      expandedTransactions,
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cashflow-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJSON = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          if (confirm('Import this data? This will replace your current plan.')) {
            importData(data);
            alert('Data imported successfully!');
          }
        } catch (err) {
          console.error('Failed to parse JSON:', err);
          alert('Failed to parse JSON file. Please check the format.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleExportPDF = () => {
    alert('PDF export coming soon! This will generate a 30-day forecast PDF.');
  };

  const handleExportSnapshotPDF = () => {
    alert('Snapshot PDF export coming soon! This will generate a cash flow snapshot PDF.');
  };

  return (
    <Layout
      onExportJSON={handleExportJSON}
      onImportJSON={handleImportJSON}
      onExportPDF={handleExportPDF}
      onExportSnapshotPDF={handleExportSnapshotPDF}
    >
      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      <main>
        {activeTab === 'dashboard' && <Dashboard />}
        {activeTab === 'whatif' && <WhatIf />}
        {activeTab === 'transactions' && <AllTransactions />}
        {activeTab === 'movements' && <CashMovements />}
        {activeTab === 'income' && <IncomePlan />}
        {activeTab === 'receivables' && <Receivables />}
        {activeTab === 'ai-insights' && <AIInsights />}
      </main>
    </Layout>
  );
}

export default App;
