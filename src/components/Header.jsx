import { Circle, Settings, RefreshCw } from 'lucide-react';

export default function Header({ activeTab, setActiveTab, syncAllWarehouses, syncAllRunning, syncProgress, isLoading }) {
  const tabs = [
    { id: 'search', label: 'Search & Quote', short: 'Search' },
    { id: 'import', label: 'Import Data', short: 'Import' },
  ];

  const handleSync = () => {
    syncAllWarehouses();
  };

  const syncing = syncAllRunning || syncProgress?.running;

  return (
    <header className="bg-primary text-white sticky top-0 z-50 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 md-px-6 py-2 md-py-3 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 md-w-10 md-h-10 bg-accent rounded-lg flex items-center justify-center">
            <Circle className="w-5 h-5 md-w-6 md-h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg md-text-xl font-bold leading-tight">QuickRev</h1>
            <p className="text-xs text-muted hide-sm">Tire Options & Estimates</p>
          </div>
        </div>

        <div className="tab-nav bg-primary-light">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="show-sm">{tab.short}</span>
              <span className="hide-sm">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            className="btn btn-sm sync-btn text-white"
            onClick={handleSync}
            disabled={syncing || isLoading}
            title="Sync all Canada Tire warehouses now"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            <span className="hide-sm">{syncing ? 'Syncing…' : 'Sync'}</span>
            <span className="show-sm">{syncing ? '…' : 'Sync'}</span>
          </button>
          {syncing && syncProgress?.running && (
            <span className="text-xs text-muted sync-progress" title={`Syncing ${syncProgress.location}`}>
              {syncProgress.current}/{syncProgress.total}
            </span>
          )}
          {syncProgress && !syncProgress.running && (
            <span className="text-xs text-muted sync-progress" title={syncProgress.failed ? `${syncProgress.failed} warehouse(s) failed` : ''}>
              {syncProgress.done}/{syncProgress.total}
              {syncProgress.failed > 0 ? ' ⚠' : ' ✓'}
            </span>
          )}
          <button className="btn btn-ghost text-white p-2 hide-sm" title="Settings">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
