/**
 * Receivables (AR) Tab Component - Accounts Receivable importer
 */

import { useState } from 'react';
import { computeARCategory, computeExpectedDate, defaultARName, makeSourceKey } from '../modules/ar.js';
import { round2 } from '../modules/calculations.js';
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
        // CSV parsing with support for quoted fields
        const lines = text.split('\n').filter(line => line.trim());

        if (lines.length === 0) {
          alert('File is empty');
          return;
        }

        // Helper function to parse CSV line with quoted field support
        const parseCSVLine = (line: string): string[] => {
          const result: string[] = [];
          let current = '';
          let inQuotes = false;

          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              result.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          result.push(current.trim());
          return result;
        };

        // Normalize header for fuzzy matching
        const normalizeHeader = (header: string): string => {
          return header
            .replace(/^\uFEFF/, '') // Remove BOM
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
        };

        // Parse header row
        const headerLine = lines[0];
        const headers = parseCSVLine(headerLine);
        const normalizedHeaders = headers.map(h => normalizeHeader(h));

        // Column detection candidates
        const COMPANY_CANDIDATES = ['customer', 'distributor', 'company', 'billto', 'soldto', 'cmoname'];
        const INVOICE_CANDIDATES = ['invoice', 'inv', 'doc', 'document', 'reference', 'ref', 'arparinvoiceid', 'arpinvoiceid'];
        const DUE_CANDIDATES = ['due', 'duedate', 'duedt', 'netdue', 'maturity', 'arpduedate'];
        const AMOUNT_CANDIDATES = ['openamount', 'balance', 'amtdue', 'amount', 'outstanding', 'openbal', 'arpinvoicebalancebase'];

        // Find best matching column for each field
        const findColumn = (candidates: string[]): number => {
          // First pass: look for exact matches
          for (let i = 0; i < normalizedHeaders.length; i++) {
            const normalized = normalizedHeaders[i];
            for (const candidate of candidates) {
              const normalizedCandidate = normalizeHeader(candidate);
              if (normalized === normalizedCandidate) {
                return i;
              }
            }
          }
          // Second pass: look for partial matches
          for (let i = 0; i < normalizedHeaders.length; i++) {
            const normalized = normalizedHeaders[i];
            for (const candidate of candidates) {
              const normalizedCandidate = normalizeHeader(candidate);
              if (normalized.includes(normalizedCandidate) && normalizedCandidate.length >= 3) {
                return i;
              }
            }
          }
          return -1;
        };

        const companyCol = findColumn(COMPANY_CANDIDATES);
        const invoiceCol = findColumn(INVOICE_CANDIDATES);
        const dueCol = findColumn(DUE_CANDIDATES);
        const amountCol = findColumn(AMOUNT_CANDIDATES);

        // Validate that we found all required columns
        if (companyCol === -1 || invoiceCol === -1 || dueCol === -1 || amountCol === -1) {
          const missing: string[] = [];
          if (companyCol === -1) missing.push('company/customer');
          if (invoiceCol === -1) missing.push('invoice');
          if (dueCol === -1) missing.push('due date');
          if (amountCol === -1) missing.push('amount/balance');
          alert(`Could not detect required columns: ${missing.join(', ')}. Please check your CSV format.`);
          return;
        }

        // Parse data rows using detected column indices
        const parsed = lines.slice(1)
          .map((line) => {
            const values = parseCSVLine(line);
            if (values.length === 0 || values.every(v => !v)) return null;

            const invoice: ARInvoice = {
              id: crypto.randomUUID(),
              company: values[companyCol] || '',
              invoice: values[invoiceCol] || '',
              due: values[dueCol] || '',
              amount: parseFloat(values[amountCol]?.replace(/[^0-9.-]/g, '') || '0') || 0,
              conf: arOptions.conf,
            };
            return invoice;
          })
          .filter((inv): inv is ARInvoice => {
            if (inv === null) return false;
            return inv.company.length > 0 && inv.invoice.length > 0 && inv.due.length > 0 && inv.amount !== 0;
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
      const parsedDue = new Date(inv.due);
      const dueDate = Number.isNaN(parsedDue.getTime())
        ? inv.due
        : parsedDue.toISOString().slice(0, 10);
      const expectedDate = computeExpectedDate(dueDate, arOptions);
      const confidence = Math.max(0, Math.min(100, arOptions.conf));
      const adjustedAmount = round2((inv.amount * confidence) / 100);
      const sourceKey = makeSourceKey(inv.company, inv.invoice) || undefined;

      const transaction: Transaction = {
        id: inv.id,
        name: defaultARName(inv.company, inv.invoice),
        category: computeARCategory(adjustedAmount, arOptions),
        amount: adjustedAmount,
        type: 'income',
        date: expectedDate,
        recurring: false,
        steps: [],
        escalatorPct: 0,
        source: 'AR',
        status: 'pending',
        company: inv.company,
        invoice: inv.invoice,
        dueDate,
        confidencePct: confidence,
        ...(sourceKey ? { sourceKey } : {}),
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
