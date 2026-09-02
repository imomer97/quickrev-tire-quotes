import { Settings, RefreshCw, Cloud, CloudOff } from 'lucide-react';
import logoUrl from '../assets/quickrev-logo.png';

export default function Header({ activeTab, setActiveTab, syncAllWarehouses, syncAllRunning, syncProgress, isLoading, cloudSyncStatus, onRetryCloudSync }) {
  const tabs = [
    { id: 'search', label: 'Search & Quote', short: 'Search' },
    { id: 'import', label: 'Import Data', short: 'Import' },
  ];

  const handleSync = () => {
    syncAllWarehouses();
  };

  const syncing = syncAllRunning || syncProgress?.running;

  return (
    <header className="bg-white text-primary sticky top-0 z-50 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 md-px-6 py-2 md-py-3 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <img src={logoUrl} alt="QuickRev" className="h-6 md:h-7 w-auto shrink-0" />
        </div>

        <div className="tab-nav">
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
          {/* Cloud sync for manual tires & edits (visible on every tab so a
              failed push is obvious instead of silently dropping items). */}
          {(() => {
            const err = cloudSyncStatus === 'error';
            const syncing = cloudSyncStatus === 'syncing';
            const ok = cloudSyncStatus === 'ok';
            let color = '#9ca3af'; // idle/connecting
            let Icon = Cloud;
            let label = 'Cloud…';
            let title = 'Connecting to the shared QuickRev data…';
            if (err)   { color = 'var(--danger)'; Icon = CloudOff; label = 'Cloud off'; title = 'Manual tires and edits are NOT reaching other devices. Retry to send them.'; }
            else if (syncing) { color = 'var(--warning)'; Icon = RefreshCw; label = 'Syncing…'; title = 'Uploading manual tires & edits…'; }
            else if (ok) { color = 'var(--success)'; Icon = Cloud; label = 'Cloud synced'; title = 'Manual tires & edits are shared with your other devices.'; }
            return (
              <div
                className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-primary whitespace-nowrap"
                style={{ background: err ? 'rgba(239,68,68,0.16)' : 'rgba(15,23,42,0.07)' }}
                title={title}
              >
                <Icon className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} style={{ color }} />
                <span>{label}</span>
                {err && (
                  <button
                    className="inline underline underline-offset-2 hover:opacity-75"
                    onClick={onRetryCloudSync}
                    title="Retry uploading manual tires & edits"
                  >
                    Retry
                  </button>
                )}
              </div>
            );
          })()}
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
          {syncing && syncProgress?.running && syncProgress.total > 1 && (
            <span className="text-xs text-muted sync-progress" title={`Syncing ${syncProgress.location}`}>
              {syncProgress.current}/{syncProgress.total}
            </span>
          )}
          {syncProgress && !syncProgress.running && syncProgress.total > 1 && (
            <span className="text-xs text-muted sync-progress" title={syncProgress.failed ? `${syncProgress.failed} warehouse(s) failed` : ''}>
              {syncProgress.done}/{syncProgress.total}
              {syncProgress.failed > 0 ? ' ⚠' : ' ✓'}
            </span>
          )}
          <button className="btn btn-ghost text-primary p-2 hide-sm" title="Settings">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
