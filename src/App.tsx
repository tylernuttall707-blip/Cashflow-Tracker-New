import { useState } from 'react'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div className="App">
      <h1>Cashflow Tracker</h1>
      <p>React + TypeScript Migration in Progress</p>
      <div className="card">
        <button onClick={() => setCount((count) => count + 1)}>
          count is {count}
        </button>
        <p>
          Phase 1 Complete: Infrastructure & TypeScript Modules
        </p>
      </div>
    </div>
  )
}

export default App
