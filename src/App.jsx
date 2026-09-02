import { useState } from 'react';
import Header from './components/Header.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import ImportPanel from './components/ImportPanel.jsx';
import { useTireData } from './hooks/useTireData.js';

export default function App() {
  const [activeTab, setActiveTab] = useState('search');
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
    distributors,
    addDistributor,
    removeDistributor,
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
          />
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