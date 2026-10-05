import { useState } from 'react';
import Header from './components/Header.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import FitmentFinder from './components/FitmentFinder.jsx';
import BundleBuilder from './components/BundleBuilder.jsx';
import ImportPanel from './components/ImportPanel.jsx';
import CustomersPage from './components/CustomersPage.jsx';
import SettingsPage from './components/SettingsPage.jsx';
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
  // Bundles queued from the Bundle Builder tab, consumed as quote line items
  // by the Search & Quote tab (one line per bundle: tires × 4 + install).
  const [pendingBundles, setPendingBundles] = useState([]);
  const addBundlesToQuote = (items) => {
    setPendingBundles(prev => [...prev, ...items]);
    setActiveTab('search');
  };
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
    pricingConfig,
    setPricingConfig,
    fitments,
    addFitment,
    setFitments,
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
        pricingConfig={pricingConfig}
        setPricingConfig={setPricingConfig}
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
            pendingBundles={pendingBundles}
            onPendingBundlesConsumed={() => setPendingBundles([])}
            pricingConfig={pricingConfig}
            setPricingConfig={setPricingConfig}
          />
        )}
        {activeTab === 'fitment' && (
          <FitmentFinder
            fitments={fitments}
            onAddFitment={addFitment}
            addTire={addTire}
            tires={tires}
          />
        )}
        {activeTab === 'bundles' && (
          <BundleBuilder
            tires={tires}
            fitments={fitments}
            pricingConfig={pricingConfig}
            setPricingConfig={setPricingConfig}
            onAddBundles={addBundlesToQuote}
            warehouseLocations={warehouseLocations}
            distributors={distributors}
          />
        )}
        {activeTab === 'customers' && (
          <CustomersPage quotes={quoteHistory} refreshQuoteHistory={refreshQuoteHistory} onQuoteForCustomer={(payload) => { setQuotePreload(payload); setActiveTab('search'); }} />
        )}
        {activeTab === 'settings' && (
          <SettingsPage pricingConfig={pricingConfig} setPricingConfig={setPricingConfig} />
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
            fitments={fitments}
            setFitments={setFitments}
          />
        )}
      </main>
    </div>
  );
}