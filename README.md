# 2025 Cash Flow (Static App)

A lightweight, single-page cash flow forecaster that runs entirely on GitHub Pages (no servers).  
Track one-off cash movements (expenses/inflows), set up recurring income streams, adjust starting balance, and visualize the projected bank balance through **December 31, 2025**.

## Features
- **Three tabs**
  - **Dashboard**: starting balance/date, end date (defaults to 2025-12-31), quick stats, upcoming 14-day schedule, and a line chart of projected balance.
  - **Cash Movements**: one-off transactions (Expense or Income) with date, description, category, amount.
  - **Income Plan**: recurring income streams (Once, Daily, Weekly, Biweekly, Monthly) with date bounds and scheduling options.
- **Adjustments**: add ad-hoc corrections if reality drifts from projections.
- **Local storage**: all data stays in your browser (`localStorage`).
- **Import/Export**: backup or move your plan across browsers.
- **Business-day aware**: optional “skip weekends” for Daily income streams.

## Quick Start (GitHub Pages)
1. Create a new GitHub repo (public or private).
2. Add these four files: `index.html`, `app.js`, `styles.css`, `README.md`.
3. Commit and push.
4. In the repo: **Settings → Pages → Build and deployment**  
   - Source: **Deploy from branch**  
   - Branch: **main** (or `master`) / root  
   - Save. After a minute, your site will be live at the URL shown.
5. Open the site and start entering data. Everything saves automatically.

## Data Model (saved under `cashflow2025_v1` in localStorage)
```json
{
  "settings": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "startingBalance": 0 },
  "adjustments": [ { "id": "a1", "date": "YYYY-MM-DD", "amount": 0, "note": "" } ],
  "oneOffs": [ { "id": "o1", "date": "YYYY-MM-DD", "type": "expense|income", "name": "", "category": "", "amount": 0 } ],
  "incomeStreams": [
    {
      "id":"s1","name":"","category":"",
      "amount":0,
      "frequency":"once|daily|weekly|biweekly|monthly",
      "onDate":"YYYY-MM-DD",         // for once
      "skipWeekends":false,          // for daily
      "dayOfWeek":0,                 // 0=Sun..6=Sat (weekly/biweekly)
      "dayOfMonth":1,                // 1..31 (monthly; clamped to last day if needed)
      "startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"
    }
  ]
}
