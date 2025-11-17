/**
 * Receivables (AR) Tab Component - Accounts Receivable importer
 */

import { useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { AROptions, ARInvoice, Transaction } from '../types';

export function Receivables() {
  const { addOneOff } = useAppStore();

  const [arOptions, setArOptions] = useState<AROptions>({
    roll: 'forward',
    lag: 0,
    conf: 100,
    category: 'AR',
    prune: false,
  });

  const [invoices, setInvoices] = useState<ARInvoice[]>([]);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        // Simple CSV parsing - in production, use a proper CSV library
        const lines = text.split('\n');

        const parsed: ARInvoice[] = lines.slice(1)
          .filter(line => line.trim())
          .map((line) => {
            const values = line.split(',').map(v => v.trim());
            return {
              id: crypto.randomUUID(),
              company: values[0] || '',
              invoice: values[1] || '',
              due: values[2] || '',
              amount: parseFloat(values[3]) || 0,
              conf: arOptions.conf,
            };
          });

        setInvoices(parsed);
        alert(`Parsed ${parsed.length} invoices from file`);
      } catch (err) {
        console.error('Failed to parse AR file:', err);
        alert('Failed to parse AR file. Please check the format.');
      }
    };
    reader.readAsText(file);
  };

  const handlePreview = () => {
    if (invoices.length === 0) {
      alert('No invoices loaded. Please upload a file first.');
    } else {
      alert(`Preview: ${invoices.length} invoices ready to import`);
    }
  };

  const handleImport = () => {
    const toImport = invoices.filter(inv => selectedInvoices.has(inv.id));

    if (toImport.length === 0) {
      alert('No invoices selected for import');
      return;
    }

    toImport.forEach(inv => {
      // Apply lag to due date
      const dueDate = new Date(inv.due);
      dueDate.setDate(dueDate.getDate() + arOptions.lag);

      // Apply weekend rolling if needed
      if (arOptions.roll !== 'none') {
        const day = dueDate.getDay();
        if (day === 0) { // Sunday
          dueDate.setDate(dueDate.getDate() + (arOptions.roll === 'forward' ? 1 : -2));
        } else if (day === 6) { // Saturday
          dueDate.setDate(dueDate.getDate() + (arOptions.roll === 'forward' ? 2 : -1));
        }
      }

      const expectedDate = dueDate.toISOString().slice(0, 10);
      const adjustedAmount = (inv.amount * inv.conf) / 100;

      const transaction: Transaction = {
        id: inv.id,
        name: `AR: ${inv.company} - ${inv.invoice}`,
        category: arOptions.category,
        amount: adjustedAmount,
        type: 'income',
        date: expectedDate,
        recurring: false,
        steps: [],
        escalatorPct: 0,
        source: 'AR Import',
        status: 'imported',
      };

      addOneOff(transaction);
    });

    alert(`Imported ${toImport.length} AR transactions`);
    setInvoices([]);
    setSelectedInvoices(new Set());
  };

  const handleSelectAll = () => {
    if (selectedInvoices.size === invoices.length) {
      setSelectedInvoices(new Set());
    } else {
      setSelectedInvoices(new Set(invoices.map(inv => inv.id)));
    }
  };

  const toggleInvoiceSelection = (id: string) => {
    const newSelection = new Set(selectedInvoices);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    setSelectedInvoices(newSelection);
  };

  const fmtDate = (ymd: string): string => {
    if (!ymd) return '';
    try {
      const d = new Date(ymd);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return ymd;
    }
  };

  const fmtMoney = (amount: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  return (
    <section id="receivables" className="tab-panel active">
      <div className="card">
        <h2>Receivables (AR) Importer</h2>
        <div className="ar-controls">
          <div className="field">
            <label htmlFor="arFile">Upload AR aging file</label>
            <input
              id="arFile"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileUpload}
            />
          </div>
        </div>

        <div className="ar-options">
          <div className="field">
            <label htmlFor="arRoll">Weekend roll</label>
            <select
              id="arRoll"
              value={arOptions.roll}
              onChange={(e) => setArOptions({ ...arOptions, roll: e.target.value as any })}
            >
              <option value="forward">Roll forward</option>
              <option value="back">Roll back</option>
              <option value="none">No roll</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="arLag">Payment lag (days)</label>
            <input
              id="arLag"
              type="number"
              value={arOptions.lag}
              min="0"
              step="1"
              onChange={(e) => setArOptions({ ...arOptions, lag: parseInt(e.target.value) || 0 })}
            />
          </div>
          <div className="field">
            <label htmlFor="arConf">Confidence %</label>
            <input
              id="arConf"
              type="number"
              value={arOptions.conf}
              min="0"
              max="100"
              step="1"
              onChange={(e) => setArOptions({ ...arOptions, conf: parseInt(e.target.value) || 100 })}
            />
          </div>
          <div className="field">
            <label htmlFor="arCategory">Category</label>
            <input
              id="arCategory"
              type="text"
              value={arOptions.category}
              onChange={(e) => setArOptions({ ...arOptions, category: e.target.value })}
            />
          </div>
          <div className="field checkbox-field">
            <label className="checkbox-label">
              <input
                id="arPrune"
                type="checkbox"
                checked={arOptions.prune}
                onChange={(e) => setArOptions({ ...arOptions, prune: e.target.checked })}
              />
              Prune invoices missing from this import (archive)
            </label>
          </div>
          <div className="field actions-inline">
            <button onClick={handlePreview} className="btn">
              Preview
            </button>
            <button
              onClick={handleImport}
              className="btn"
              disabled={selectedInvoices.size === 0}
            >
              Import ({selectedInvoices.size})
            </button>
          </div>
        </div>

        <div className="ar-status">
          {invoices.length > 0 && (
            <p>
              Loaded {invoices.length} invoice(s). Select which ones to import below.
            </p>
          )}
        </div>

        <div className="ar-preview-wrapper">
          <table className="table ar-preview">
            <thead>
              <tr>
                <th className="select-col">
                  <label className="ar-select-all">
                    <input
                      type="checkbox"
                      checked={selectedInvoices.size === invoices.length && invoices.length > 0}
                      onChange={handleSelectAll}
                    />
                    <span>Select All</span>
                  </label>
                </th>
                <th>Company</th>
                <th>Invoice</th>
                <th>Due</th>
                <th>Amount</th>
                <th>Conf %</th>
                <th>Expected</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const dueDate = new Date(inv.due);
                dueDate.setDate(dueDate.getDate() + arOptions.lag);
                const expectedDate = dueDate.toISOString().slice(0, 10);
                const adjustedAmount = (inv.amount * arOptions.conf) / 100;

                return (
                  <tr key={inv.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedInvoices.has(inv.id)}
                        onChange={() => toggleInvoiceSelection(inv.id)}
                      />
                    </td>
                    <td>{inv.company}</td>
                    <td>{inv.invoice}</td>
                    <td>{fmtDate(inv.due)}</td>
                    <td>{fmtMoney(inv.amount)}</td>
                    <td>{arOptions.conf}%</td>
                    <td>
                      {fmtDate(expectedDate)} ({fmtMoney(adjustedAmount)})
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
