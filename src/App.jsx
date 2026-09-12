import { useState } from 'react';
import Header from './components/Header.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import ImportPanel from './components/ImportPanel.jsx';
import CustomersPage from './components/CustomersPage.jsx';
import { useTireData } from './hooks/useTireData.js';
import { useQuoteHistory } from './hooks/useQuoteHistory.js';

export default function App() {
  const [activeTab, setActiveTab] = useState('search');
  // Preload payload passed from the Customers tab into a new quote (customer
  // clicked → name/email/vehicle/postal land in the Search & Quote fields).
  const [quotePreload, setQuotePreload] = useState(null);
  // Quote history is shared with the Customers tab; loaded once here and
  // passed down so both views show the same data.
  const { quotes: quoteHistory, refresh: refreshQuoteHistory } = useQuoteHistory();
  const {
    tires,
    isLoading,
    apiStatus,
    addTire,  // ADD THIS LINE
    updateTire,
    deleteTire,
    deleteTires,
    bulkUpdateTires,
    clearAll,
    importFromCSV,
    loadSampleData,
    syncCanadaTire,
    syncAllWarehouses,
    exportData,
    importData,
    syncAllRunning,
    syncProgress,
    checkApiHealth,
    warehouseLocations,
    lastSyncAt,
    addWarehouseLocations,
    fetchWarehouseLocations,
    cloudSyncStatus,
    retryCloudSync,
    distributors,
    addDistributor,
    removeDistributor,
    installServiceRates,
    setInstallServiceRates,
  } = useTireData();

  return (
    <div className="app-container">
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        syncAllWarehouses={syncAllWarehouses}
        syncAllRunning={syncAllRunning}
        syncProgress={syncProgress}
        isLoading={isLoading}
        cloudSyncStatus={cloudSyncStatus}
        onRetryCloudSync={retryCloudSync}
      />
      <main className="app-main">
        {activeTab === 'search' && (
          <SearchPanel 
            tires={tires} 
            updateTire={updateTire} 
            deleteTire={deleteTire}
            addTire={addTire}  // ADD THIS LINE
            bulkUpdateTires={bulkUpdateTires}
            warehouseLocations={warehouseLocations}
            lastSyncAt={lastSyncAt}
            distributors={distributors}
            onAddDistributor={addDistributor}
            preload={quotePreload}
            onPreloadConsumed={() => setQuotePreload(null)}
          />
        )}
        {activeTab === 'customers' && (
          <CustomersPage quotes={quoteHistory} refreshQuoteHistory={refreshQuoteHistory} onQuoteForCustomer={(payload) => { setQuotePreload(payload); setActiveTab('search'); }} />
        )}
        {activeTab === 'import' && (
          <ImportPanel
            tires={tires}
            importFromCSV={importFromCSV}
            clearAll={clearAll}
            loadSampleData={loadSampleData}
            deleteTires={deleteTires}
            syncCanadaTire={syncCanadaTire}
            syncAllWarehouses={syncAllWarehouses}
            syncAllRunning={syncAllRunning}
            checkApiHealth={checkApiHealth}
            apiStatus={apiStatus}
            isLoading={isLoading}
            warehouseLocations={warehouseLocations}
            lastSyncAt={lastSyncAt}
            addWarehouseLocations={addWarehouseLocations}
            fetchWarehouseLocations={fetchWarehouseLocations}
            exportData={exportData}
            importData={importData}
            cloudStatus={cloudSyncStatus}
            distributors={distributors}
            addDistributor={addDistributor}
            removeDistributor={removeDistributor}
          />
        )}
      </main>
    </div>
  );
}