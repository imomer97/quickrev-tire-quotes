import { useState, useRef, useEffect } from 'react';
import { Upload, Trash2, Database, AlertCircle, CheckCircle, RefreshCw, Search, Download } from 'lucide-react';
import Papa from 'papaparse';

export default function ImportPanel({ tires, importFromCSV, clearAll, loadSampleData, deleteTires, syncCanadaTire, syncAllWarehouses, syncAllRunning, checkApiHealth, apiStatus, isLoading, warehouseLocations, lastSyncAt, fetchWarehouseLocations, addWarehouseLocations, exportData, importData }) {
  const [dragActive, setDragActive] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [syncResult, setSyncResult] = useState(null);
  const [syncFilters, setSyncFilters] = useState({ size: '', brand: '', isWinter: '', warehouse: '' });
  const [confirmAction, setConfirmAction] = useState(null); // { type: 'deleteSelected' | 'clearAll' | 'importBackup' }
  const [pendingImport, setPendingImport] = useState(null); // backup text awaiting confirm
  const [page, setPage] = useState(1);
  const ROWS_PER_PAGE = 100;
  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);

  useEffect(() => {
    checkApiHealth();
  }, [checkApiHealth]);

  // Populate the warehouse dropdown the first time the tab is opened
  useEffect(() => {
    if (warehouseLocations.length === 0) fetchWarehouseLocations();
  }, [warehouseLocations.length, fetchWarehouseLocations]);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
  };

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) processFile(e.target.files[0]);
  };

  const processFile = (file) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const count = importFromCSV(results.data);
        setImportResult({ type: 'success', message: `Imported ${count} tires from ${file.name}` });
        setTimeout(() => setImportResult(null), 4000);
      },
      error: (err) => setImportResult({ type: 'error', message: `Error: ${err.message}` }),
    });
  };

  const handleDeleteSelected = () => {
    if (selectedRows.size === 0) return;
    setConfirmAction({ type: 'deleteSelected' });
  };

  const confirmDelete = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'deleteSelected') {
      const n = selectedRows.size;
      deleteTires(Array.from(selectedRows));
      setSelectedRows(new Set());
      setImportResult({ type: 'success', message: `Deleted ${n} tire(s)` });
    } else if (confirmAction.type === 'clearAll') {
      clearAll();
      setSelectedRows(new Set());
      setImportResult({ type: 'success', message: 'All tire data cleared' });
    } else if (confirmAction.type === 'importBackup' && pendingImport) {
      const result = importData(pendingImport);
      setSelectedRows(new Set());
      setImportResult(result.success
        ? { type: 'success', message: `Added ${result.added} tire(s) from backup${result.skipped ? ` — ${result.skipped} already present, skipped` : ''}` }
        : { type: 'error', message: result.error });
      setPendingImport(null);
    }
    setConfirmAction(null);
    setTimeout(() => setImportResult(null), 4000);
  };

  const toggleRow = (id) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedRows.size === tires.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(tires.map(t => t.id)));
  };

  // Parse a tire size in any common format into structured fields:
  // 205/55R16, 20555R16, 2055516, P205/55R16, 205/55ZR16, 205 55 16, etc.
  const parseSyncSize = (raw) => {
    const cleaned = raw.trim().toUpperCase();
    const match = cleaned.match(/^(?:P)?(\d{3})\D*(\d{2,3})(?:[A-Z]?R)?(\d{2})$/);
    if (!match) return null;
    return {
      width: parseInt(match[1], 10),
      aspect: parseInt(match[2], 10),
      rim: parseInt(match[3], 10),
    };
  };

  const handleSync = async () => {
    setSyncResult(null);
    const filters = {};
    if (syncFilters.size) {
      const parsed = parseSyncSize(syncFilters.size);
      if (parsed) {
        filters.width = parsed.width;
        filters.aspectRatio = parsed.aspect;
        filters.rimSize = parsed.rim;
      } else {
        // Fallback: send the compact form (numbers + letters, no slashes)
        filters.size = syncFilters.size.replace(/[^0-9a-z]/gi, '').toUpperCase();
      }
    }
    if (syncFilters.brand) filters.brand = syncFilters.brand;
    if (syncFilters.isWinter !== '') filters.isWinter = syncFilters.isWinter === 'true';
    if (syncFilters.warehouse) filters.location = syncFilters.warehouse;

    const result = await syncCanadaTire(filters);
    if (result.success) {
      const extra = result.truncated
        ? ' — Canada Tire returned more tires than the app stores; only the imported ones were kept.'
        : '';
      setSyncResult({ type: 'success', message: `Synced ${result.count} tires from Canada Tire API${extra}` });
      if (result.locations?.length) addWarehouseLocations(result.locations);
    } else {
      setSyncResult({ type: 'error', message: result.error || 'Sync failed' });
    }
    setTimeout(() => setSyncResult(null), 5000);
  };

  // Sync every known warehouse's inventory and merge the results
  const handleSyncAll = async () => {
    setSyncResult(null);
    const result = await syncAllWarehouses();
    if (result.success) {
      setSyncResult({ type: 'success', message: `Synced ${result.count} tires from the Canada Tire catalog` });
    } else {
      const extra = result.failures?.length
        ? ` (failed: ${result.failures.join(', ')})`
        : '';
      setSyncResult({ type: 'error', message: (result.error || 'Sync failed') + extra });
    }
    setTimeout(() => setSyncResult(null), 6000);
  };

  // Download a full JSON backup of the inventory
  const handleExport = () => {
    const data = exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quickrev-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJsonImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPendingImport(reader.result);
      setConfirmAction({ type: 'importBackup' });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const formatSyncTime = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const apiConfigured = apiStatus?.status === 'ok';

  return (
    <div className="flex-col gap-6">
      {/* === CANADA TIRE API SYNC === */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin text-accent' : 'text-accent'}`} />
          Canada Tire API Sync
        </h2>

        <div className="flex items-center gap-2 mb-4">
          <div className={`w-2 h-2 rounded-full ${apiConfigured ? 'bg-success' : 'bg-danger'}`} />
          <span className="text-sm">
            {apiConfigured ? 'API credentials configured' : apiStatus?.missing?.length > 0 ? `Missing: ${apiStatus.missing.join(', ')}` : 'Proxy server not running'}
          </span>
        </div>

        <div className="flex gap-3 flex-wrap mb-4">
          <input
            type="text"
            className="input w-40"
            placeholder="Size (205/55R16, 2055516...)"
            value={syncFilters.size}
            onChange={(e) => setSyncFilters(f => ({ ...f, size: e.target.value }))}
          />
          <input
            type="text"
            className="input w-40"
            placeholder="Brand"
            value={syncFilters.brand}
            onChange={(e) => setSyncFilters(f => ({ ...f, brand: e.target.value }))}
          />
          <select
            className="input select w-32"
            value={syncFilters.isWinter}
            onChange={(e) => setSyncFilters(f => ({ ...f, isWinter: e.target.value }))}
          >
            <option value="">All Seasons</option>
            <option value="false">Non-Winter</option>
            <option value="true">Winter Only</option>
          </select>
          <select
            className="input select w-44"
            value={syncFilters.warehouse}
            onChange={(e) => setSyncFilters(f => ({ ...f, warehouse: e.target.value }))}
          >
            <option value="">All Warehouses</option>
            {warehouseLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
          </select>
          <button
            className="btn btn-primary"
            onClick={handleSync}
            disabled={isLoading || !apiConfigured}
          >
            <Search className="w-4 h-4" />
            {isLoading ? 'Syncing...' : 'Sync Now'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleSyncAll}
            disabled={isLoading || syncAllRunning || !apiConfigured || warehouseLocations.length === 0}
            title="Sync every warehouse's inventory and merge the results"
          >
            <RefreshCw className={`w-4 h-4 ${syncAllRunning ? 'animate-spin' : ''}`} />
            {syncAllRunning ? 'Syncing all warehouses...' : 'Sync All Warehouses'}
          </button>
        </div>
        {(isLoading || syncAllRunning) && (
          <p className="text-xs text-muted mb-2">
            Canada Tire occasionally throttles requests — this will retry automatically and can take a few minutes.
          </p>
        )}
        <p className="text-xs text-muted mb-3 flex items-center gap-2">
          <RefreshCw className="w-3 h-3" />
          Refresh inventory any time with the Sync button at the top of the page, or here.
          {lastSyncAt && <span>Last sync: {formatSyncTime(lastSyncAt)}</span>}
        </p>

        {syncResult && (
          <div className={`p-3 rounded-lg flex items-center gap-2 text-sm ${syncResult.type === 'success' ? 'bg-green-50 text-success' : 'bg-red-50 text-danger'}`}>
            {syncResult.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {syncResult.message}
          </div>
        )}

        <p className="text-xs text-muted mt-3">
          The API proxy runs inside this app's server — no separate setup needed.
          A sync pulls the full Canada Tire catalog (Canada Tire's API returns everything in one response).
        </p>
      </div>

      {/* === CSV UPLOAD === */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Upload className="w-5 h-5 text-accent" />
          Import Tire Data (CSV)
        </h2>
        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition cursor-pointer ${dragActive ? 'border-accent bg-blue-50' : 'border-slate-200 bg-slate-50'}`}
          onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag} onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-10 h-10 text-muted mx-auto mb-3" />
          <p className="text-sm font-medium mb-1">Drop CSV file here or click to browse</p>
          <p className="text-xs text-muted">Expected: brand, model, size, wholesale, stock, season, distributor</p>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
        </div>
        {importResult && (
          <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 text-sm ${importResult.type === 'success' ? 'bg-green-50 text-success' : 'bg-red-50 text-danger'}`}>
            {importResult.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {importResult.message}
          </div>
        )}
      </div>

      {/* === DATA MANAGEMENT === */}
      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Database className="w-5 h-5 text-accent" />
          Data Management
        </h2>
        <div className="flex gap-3 flex-wrap">
          <button className="btn btn-secondary" onClick={loadSampleData}>
            <Database className="w-4 h-4" />
            Load Sample Data
          </button>
          <button className="btn btn-secondary" onClick={handleExport}>
            <Download className="w-4 h-4" />
            Export Backup
          </button>
          <button className="btn btn-secondary" onClick={() => jsonInputRef.current?.click()}>
            <Upload className="w-4 h-4" />
            Import Backup
          </button>
          <input ref={jsonInputRef} type="file" accept=".json" className="hidden" onChange={handleJsonImport} />
          <button className="btn btn-danger" onClick={() => setConfirmAction({ type: 'clearAll' })}>
            <Trash2 className="w-4 h-4" />
            Clear All Data
          </button>
          {confirmAction && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-danger">
                {confirmAction.type === 'deleteSelected'
                  ? `Delete ${selectedRows.size} selected tire(s)?`
                  : confirmAction.type === 'importBackup'
                    ? 'Merge this backup into your data? Existing tires stay; synced Canada Tire tires already present are skipped.'
                    : 'Delete ALL tire data?'}
              </span>
              <button className="btn btn-sm btn-danger" onClick={confirmDelete}>Yes, delete</button>
              <button className="btn btn-sm btn-outline" onClick={() => setConfirmAction(null)}>Cancel</button>
            </div>
          )}
        </div>
        <p className="text-sm text-muted mt-3">{tires.length} tire(s) in database</p>
      </div>

      {/* === INVENTORY TABLE === */}
      {tires.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Inventory ({tires.length})</h2>
            <div className="flex gap-2">
              <button className="btn btn-sm btn-outline" onClick={selectAll}>
                {selectedRows.size === tires.length ? 'Deselect All' : 'Select All'}
              </button>
              {selectedRows.size > 0 && (
                <button className="btn btn-sm btn-danger" onClick={handleDeleteSelected}>
                  <Trash2 className="w-4 h-4" />
                  Delete {selectedRows.size}
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted">
                  <th className="py-2 pr-2 w-8"></th>
                  <th className="py-2 pr-4">Brand</th>
                  <th className="py-2 pr-4">Model</th>
                  <th className="py-2 pr-4">Size</th>
                  <th className="py-2 pr-4">Season</th>
                  <th className="py-2 pr-4">Distributor</th>
                  <th className="py-2 pr-4">Warehouse</th>
                  <th className="py-2 pr-4 text-right">Wholesale</th>
                  <th className="py-2 pr-4 text-right">Stock</th>
                </tr>
              </thead>
              <tbody>
                {tires.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE).map(tire => (
                  <tr key={tire.id} className="border-b hover:bg-slate-50">
                    <td className="py-2 pr-2">
                      <div className={`checkbox ${selectedRows.has(tire.id) ? 'checked' : ''}`} onClick={() => toggleRow(tire.id)} title="Select" style={{ cursor: 'pointer' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M5 12l5 5L20 7" /></svg>
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      <button
                        className="btn btn-sm btn-ghost p-1 text-danger"
                        onClick={() => {
                          deleteTires([tire.id]);
                          setImportResult({ type: 'success', message: `Deleted ${tire.brand} ${tire.model}` });
                          setTimeout(() => setImportResult(null), 4000);
                        }}
                        title="Delete this tire"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                    <td className="py-2 pr-4 font-medium">{tire.brand}</td>
                    <td className="py-2 pr-4 text-muted">{tire.model}</td>
                    <td className="py-2 pr-4">{tire.size}</td>
                    <td className="py-2 pr-4">
                      <span className={`badge badge-${tire.season === 'Winter' ? 'blue' : tire.season === 'All-Season' ? 'green' : tire.season === 'All-Weather' ? 'purple' : 'yellow'}`}>{tire.season}</span>
                    </td>
                    <td className="py-2 pr-4 text-muted">{tire.distributorId}</td>
                    <td className="py-2 pr-4">
                      {tire.warehouse
                        || (tire.warehouses?.length > 1 ? 'Multiple' : '')
                        || (tire.distributorId !== 'canadaTire' ? 'Dartmouth, NS' : 'All')}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono">${tire.wholesale.toFixed(2)}</td>
                    <td className="py-2 pr-4 text-right">{tire.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination — thousands of rows must not freeze the page */}
          {tires.length > ROWS_PER_PAGE && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-xs text-muted">
                Page {page} of {Math.ceil(tires.length / ROWS_PER_PAGE)}
              </span>
              <div className="flex gap-2">
                <button
                  className="btn btn-sm btn-outline"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  disabled={page >= Math.ceil(tires.length / ROWS_PER_PAGE)}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
