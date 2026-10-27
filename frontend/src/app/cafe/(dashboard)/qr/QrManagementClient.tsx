"use client";

import React, { useState, useEffect, useRef, useTransition } from "react";
import {
  mapRawQrTables,
  type QrTableRow,
  type RawQrTable,
} from "@/lib/mappers";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Modal } from "@/components/common/Modal";
import { getTableQrAction, getTablesAction } from "@/actions/tables";

interface QrManagementClientProps {
  initialTables: QrTableRow[];
  initialTotalPages: number;
  initialTotalCount: number;
}

export const QrManagementClient: React.FC<QrManagementClientProps> = ({
  initialTables,
  initialTotalPages,
  initialTotalCount,
}) => {
  const [isPending, startTransition] = useTransition();

  // State management
  const [tables, setTables] = useState<QrTableRow[]>(initialTables);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [totalCount, setTotalCount] = useState(initialTotalCount);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterOption, setFilterOption] = useState<"ALL" | "ACTIVE" | "DISABLED" | "PATIO">("ALL");

  // QR Caching in component state
  const [qrCache, setQrCache] = useState<Record<string, string>>({});
  const [loadingQrMap, setLoadingQrMap] = useState<Record<string, boolean>>({});

  // Modals state
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [selectedTable, setSelectedTable] = useState<QrTableRow | null>(null);

  // Success Feedback Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  };

  // Fetch QR Action (Checks Cache first)
  const fetchQrCode = async (tableId: string): Promise<string | null> => {
    if (qrCache[tableId]) {
      return qrCache[tableId];
    }

    setLoadingQrMap((prev) => ({ ...prev, [tableId]: true }));
    try {
      const res = await getTableQrAction(tableId);
      if (res.success && res.qrDataUrl) {
        setQrCache((prev) => ({ ...prev, [tableId]: res.qrDataUrl }));
        return res.qrDataUrl;
      }
    } catch (err) {
      console.error(`Failed to load QR code for table ${tableId}:`, err);
    } finally {
      setLoadingQrMap((prev) => ({ ...prev, [tableId]: false }));
    }
    return null;
  };

  // Load More Tables
  const handleLoadMore = () => {
    if (currentPage >= totalPages) return;

    startTransition(async () => {
      try {
        const nextPage = currentPage + 1;
        const res = await getTablesAction(nextPage, 12);
        if (res.success) {
          const newTables = mapRawQrTables((res.tables ?? []) as RawQrTable[]);

          setTables((prev) => [...prev, ...newTables]);
          setCurrentPage(nextPage);
          setTotalPages(res.totalPages || 1);
          setTotalCount(res.totalCount || 0);
        }
      } catch (err) {
        console.error("Failed to load more tables:", err);
        alert("Failed to load more tables.");
      }
    });
  };

  // Copy Guest URL
  const handleCopyUrl = async (url: string, tableNumber: number) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast(`Guest URL for Table ${tableNumber < 10 ? "0" + tableNumber : tableNumber} copied!`);
    } catch (err) {
      console.error("Failed to copy url:", err);
      alert("Failed to copy URL to clipboard");
    }
  };

  // Download QR Code PNG
  const handleDownloadPng = async (table: QrTableRow) => {
    let qrDataUrl = qrCache[table.id];
    if (!qrDataUrl) {
      qrDataUrl = await fetchQrCode(table.id) || "";
    }
    if (!qrDataUrl) {
      alert("QR Code image is not loaded yet.");
      return;
    }

    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `qrdine_table_${table.tableNumber < 10 ? "0" + table.tableNumber : table.tableNumber}_qr.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Downloaded QR PNG for Table ${table.tableNumber < 10 ? "0" + table.tableNumber : table.tableNumber}`);
  };

  // Open Preview Modal
  const handleOpenPreview = async (table: QrTableRow) => {
    setSelectedTable(table);
    setIsPreviewOpen(true);
    // Ensure QR Code is fetched on preview open
    if (!qrCache[table.id]) {
      await fetchQrCode(table.id);
    }
  };

  // Print single table QR
  const handlePrintQr = async (table: QrTableRow) => {
    let qrDataUrl = qrCache[table.id];
    if (!qrDataUrl) {
      qrDataUrl = await fetchQrCode(table.id) || "";
    }
    if (!qrDataUrl) {
      alert("Failed to load QR code for printing");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Print QR - Table ${table.tableNumber < 10 ? "0" + table.tableNumber : table.tableNumber}</title>
          <style>
            body {
              font-family: 'Inter', sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
            }
            .card {
              border: 3px solid #51604f;
              border-radius: 24px;
              padding: 40px;
              text-align: center;
              max-width: 380px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            }
            h1 { color: #51604f; font-size: 32px; margin-bottom: 5px; font-weight: 700; }
            p { color: #5e5e5b; font-size: 16px; margin-bottom: 24px; line-height: 1.4; }
            img { width: 240px; height: 240px; margin-bottom: 20px; }
            .table-num { font-size: 26px; font-weight: 600; color: #1b1c1c; margin-top: 10px; }
          </style>
        </head>
        <body onload="window.print(); window.close();">
          <div class="card">
            <h1>QRDine Menu</h1>
            <p>Scan to view menu & order directly from your table</p>
            <img src="${qrDataUrl}" alt="Table QR" />
            <div class="table-num">Table ${table.tableNumber < 10 ? "0" + table.tableNumber : table.tableNumber}</div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Bulk Print loaded active QR codes
  const handlePrintAll = async () => {
    const activeTables = tables.filter((t) => t.isActive);
    if (activeTables.length === 0) {
      alert("No active tables to print.");
      return;
    }

    // Fetch QRs for all active tables first
    showToast("Preparing active tables QR codes for bulk printing...");
    const printItems: { num: string; qr: string }[] = [];
    for (const table of activeTables) {
      let qr = qrCache[table.id];
      if (!qr) {
        qr = await fetchQrCode(table.id) || "";
      }
      if (qr) {
        printItems.push({
          num: table.tableNumber < 10 ? "0" + table.tableNumber : String(table.tableNumber),
          qr,
        });
      }
    }

    if (printItems.length === 0) {
      alert("Failed to load any QR codes for printing.");
      return;
    }

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    const cardsHtml = printItems
      .map(
        (item) => `
        <div class="card">
          <h1>QRDine Menu</h1>
          <p>Scan to view menu & order directly from your table</p>
          <img src="${item.qr}" alt="Table ${item.num} QR" />
          <div class="table-num">Table ${item.num}</div>
        </div>
      `
      )
      .join("");

    printWindow.document.write(`
      <html>
        <head>
          <title>Print All QRs - QRDine</title>
          <style>
            body {
              font-family: 'Inter', sans-serif;
              margin: 0;
              padding: 20px;
              display: flex;
              flex-wrap: wrap;
              gap: 30px;
              justify-content: center;
              background-color: #ffffff;
            }
            .card {
              border: 3px solid #51604f;
              border-radius: 24px;
              padding: 30px;
              text-align: center;
              width: 320px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.05);
              page-break-inside: avoid;
            }
            h1 { color: #51604f; font-size: 28px; margin-bottom: 5px; font-weight: 700; margin-top: 0; }
            p { color: #5e5e5b; font-size: 14px; margin-bottom: 20px; line-height: 1.4; }
            img { width: 200px; height: 200px; }
            .table-num { font-size: 22px; font-weight: 600; color: #1b1c1c; margin-top: 10px; }
            @media print {
              body { padding: 0; }
              .card { box-shadow: none; border-color: #51604f; margin-bottom: 40px; }
            }
          </style>
        </head>
        <body onload="window.print(); window.close();">
          ${cardsHtml}
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Compute metrics from current table list state
  const activeTablesCount = tables.filter((t) => t.isActive).length;
  const disabledTablesCount = tables.filter((t) => !t.isActive).length;

  // Filter & Search tables
  const filteredTables = tables
    .filter((table) => {
      const matchesSearch = String(table.tableNumber).includes(searchQuery);

      const matchesFilter =
        filterOption === "ALL" ||
        (filterOption === "ACTIVE" && table.isActive) ||
        (filterOption === "DISABLED" && !table.isActive) ||
        (filterOption === "PATIO" && table.isActive); // visual map fallback for demo

      return matchesSearch && matchesFilter;
    })
    .sort((a, b) => a.tableNumber - b.tableNumber); // Default sort: Table number

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      {/* Top Header Bar */}
      <TopAppBar title="QR Code Management" iconName="qr_code" />

      {/* Main Canvas Area */}
      <main className="flex-1 p-margin-desktop overflow-y-auto">
        <div className="max-w-[1280px] mx-auto">
          {/* Section Heading & Actions */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-md mb-lg">
            <div>
              <h2 className="font-semibold text-headline-lg text-on-surface">QR Code Management</h2>
              <p className="text-body-md text-on-surface-variant mt-xs">
                Generate, download, and manage QR codes for all tables.
              </p>
            </div>
            <div className="flex gap-sm">
              <button
                disabled
                className="flex items-center gap-2 px-md py-2 bg-surface-container-lowest border border-surface-container text-on-surface-variant/40 font-semibold text-body-sm rounded-lg opacity-50 cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">add_box</span>
                Generate Bulk QR
              </button>
              <button
                onClick={handlePrintAll}
                className="flex items-center gap-2 px-md py-2 bg-primary text-on-primary font-semibold text-body-sm rounded-lg hover:bg-primary/95 transition-all shadow-[0px_4px_12px_rgba(81,96,79,0.15)] active:scale-95 duration-200 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">print</span>
                Print All Active
              </button>
            </div>
          </div>

          {/* Stats Cards Section */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-gutter mb-lg">
            {/* Total Tables */}
            <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md flex items-center gap-md shadow-[0px_2px_8px_rgba(0,0,0,0.02)]">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <span className="material-symbols-outlined text-[24px]">table_restaurant</span>
              </div>
              <div>
                <p className="text-body-sm text-on-surface-variant font-medium uppercase tracking-wider text-[11px]">Total Tables</p>
                <h4 className="text-title-lg font-bold text-on-surface mt-xs leading-none">{totalCount}</h4>
              </div>
            </div>

            {/* QR Generated */}
            <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md flex items-center gap-md shadow-[0px_2px_8px_rgba(0,0,0,0.02)]">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <span className="material-symbols-outlined text-[24px]">qr_code_2</span>
              </div>
              <div>
                <p className="text-body-sm text-on-surface-variant font-medium uppercase tracking-wider text-[11px]">QR Generated</p>
                <h4 className="text-title-lg font-bold text-on-surface mt-xs leading-none">{totalCount}</h4>
              </div>
            </div>

            {/* Active Tables */}
            <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md flex items-center gap-md shadow-[0px_2px_8px_rgba(0,0,0,0.02)]">
              <div className="w-12 h-12 rounded-lg bg-accent-mint-container flex items-center justify-center text-success shrink-0">
                <span className="material-symbols-outlined text-[24px]">check_circle</span>
              </div>
              <div>
                <p className="text-body-sm text-on-surface-variant font-medium uppercase tracking-wider text-[11px]">Active Tables</p>
                <h4 className="text-title-lg font-bold text-on-surface mt-xs leading-none">{activeTablesCount}</h4>
              </div>
            </div>

            {/* Disabled Tables */}
            <div className="bg-surface-container-lowest border border-surface-container rounded-xl p-md flex items-center gap-md shadow-[0px_2px_8px_rgba(0,0,0,0.02)]">
              <div className="w-12 h-12 rounded-lg bg-error-container/40 flex items-center justify-center text-error shrink-0">
                <span className="material-symbols-outlined text-[24px]">block</span>
              </div>
              <div>
                <p className="text-body-sm text-on-surface-variant font-medium uppercase tracking-wider text-[11px]">Disabled Tables</p>
                <h4 className="text-title-lg font-bold text-on-surface mt-xs leading-none">{disabledTablesCount}</h4>
              </div>
            </div>
          </div>

          {/* Filters & Search Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-sm mb-md border-b border-surface-container pb-md">
            {/* Filter Tabs */}
            <div className="flex items-center gap-xs">
              <button
                onClick={() => setFilterOption("ALL")}
                className={`px-md py-1.5 rounded-full text-body-sm font-semibold transition-colors cursor-pointer ${
                  filterOption === "ALL"
                    ? "bg-surface-container-high text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                All Tables
              </button>
              <button
                onClick={() => setFilterOption("ACTIVE")}
                className={`px-md py-1.5 rounded-full text-body-sm font-semibold transition-colors cursor-pointer ${
                  filterOption === "ACTIVE"
                    ? "bg-surface-container-high text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                Active Only
              </button>
              <button
                onClick={() => setFilterOption("DISABLED")}
                className={`px-md py-1.5 rounded-full text-body-sm font-semibold transition-colors cursor-pointer ${
                  filterOption === "DISABLED"
                    ? "bg-surface-container-high text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                Disabled Only
              </button>
            </div>

            {/* Sort/Search Info */}
            <div className="flex items-center gap-md">
              <div className="flex items-center gap-1 text-[13px] text-on-surface-variant">
                <span className="material-symbols-outlined text-[18px]">sort</span>
                Sort by: Table Number
              </div>
              {/* Search Input */}
              <div className="relative w-full sm:w-64">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40 text-[18px]">
                  search
                </span>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-surface-container-lowest border border-surface-container rounded-full py-1.5 pl-9 pr-4 text-body-sm text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none transition-all"
                  placeholder="Search table number..."
                  type="text"
                />
              </div>
            </div>
          </div>

          {/* QR Code Gallery Grid */}
          {filteredTables.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-gutter pb-xl">
              {filteredTables.map((table) => (
                <QrCodeCard
                  key={table.id}
                  table={table}
                  cachedQr={qrCache[table.id]}
                  isLoadingQr={loadingQrMap[table.id] || false}
                  onLazyLoad={fetchQrCode}
                  onPreview={handleOpenPreview}
                  onDownload={handleDownloadPng}
                  onCopy={handleCopyUrl}
                  onPrint={handlePrintQr}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 bg-surface-container-lowest rounded-xl border border-surface-container text-center px-4">
              <span className="material-symbols-outlined text-[48px] text-on-surface-variant/20 mb-sm">
                qr_code_scanner
              </span>
              <h3 className="font-semibold text-headline-sm text-on-surface">No Tables Found</h3>
              <p className="text-body-md text-on-surface-variant/60 mt-xs max-w-[24rem]">
                We couldn&apos;t find any tables matching your current search or filter query.
              </p>
            </div>
          )}

          {/* Load More Tables */}
          {currentPage < totalPages && (
            <div className="mt-10 flex justify-center pb-xl">
              <button
                onClick={handleLoadMore}
                disabled={isPending}
                className="px-6 py-2 rounded-full border border-surface-container text-on-surface font-semibold text-body-sm hover:bg-surface-container-low transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                {isPending ? "Loading..." : "Load More Tables"}
              </button>
            </div>
          )}
        </div>
      </main>

      {/* QR Preview Modal */}
      {isPreviewOpen && selectedTable && (
        <Modal
          isOpen={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false);
            setSelectedTable(null);
          }}
          title={`Table ${selectedTable.tableNumber < 10 ? "0" + selectedTable.tableNumber : selectedTable.tableNumber} QR Code`}
        >
          <div className="flex flex-col items-center gap-md font-inter py-2">
            {/* Aspect Square QR Container */}
            <div className="w-64 h-64 bg-surface-container-low rounded-xl border border-surface-container flex items-center justify-center p-4 relative overflow-hidden">
              {loadingQrMap[selectedTable.id] ? (
                <div className="flex flex-col items-center gap-sm">
                  <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <span className="text-[12px] text-on-surface-variant/60 font-medium">Generating QR...</span>
                </div>
              ) : qrCache[selectedTable.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrCache[selectedTable.id]}
                  alt={`Table ${selectedTable.tableNumber} QR Code`}
                  className="w-full h-full object-contain mix-blend-multiply"
                />
              ) : (
                <div className="text-center text-[12px] text-error font-medium">
                  Failed to load QR code
                </div>
              )}
            </div>

            {/* Active Status Badge */}
            <div className="flex items-center gap-sm">
              <span className="text-body-sm text-on-surface-variant">Status:</span>
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-semibold text-[11px] uppercase tracking-wider ${
                  selectedTable.isActive
                    ? "bg-active-accent text-on-active-accent"
                    : "bg-surface-variant text-on-surface-variant"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    selectedTable.isActive ? "bg-on-active-accent" : "bg-on-surface-variant"
                  }`}
                />
                {selectedTable.isActive ? "Active" : "Disabled"}
              </span>
            </div>

            {/* Guest URL Text Input with Copy Action */}
            <div className="w-full flex flex-col gap-xs">
              <label className="text-[11px] font-semibold text-on-surface-variant/80 uppercase tracking-wider">
                Guest Scanner URL
              </label>
              <div className="flex items-center gap-sm">
                <input
                  type="text"
                  readOnly
                  value={selectedTable.guestUrl}
                  className="flex-1 bg-surface-container-low border border-surface-container rounded-lg px-sm py-2 text-body-sm text-on-surface outline-none select-all truncate"
                />
                <button
                  onClick={() => handleCopyUrl(selectedTable.guestUrl, selectedTable.tableNumber)}
                  className="flex items-center justify-center w-9 h-9 bg-primary text-on-primary rounded-lg hover:bg-primary/95 transition-all duration-150 cursor-pointer active:scale-95"
                  title="Copy Link"
                >
                  <span className="material-symbols-outlined text-[18px]">content_copy</span>
                </button>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="w-full flex flex-col gap-2 mt-sm border-t border-surface-container pt-md">
              <div className="flex gap-2">
                <button
                  onClick={() => handleDownloadPng(selectedTable)}
                  className="flex-1 flex items-center justify-center gap-sm bg-surface-container-lowest border border-surface-container text-on-surface font-semibold text-body-sm py-2 rounded-lg hover:bg-surface-container-low transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  Download PNG
                </button>
                <button
                  onClick={() => handlePrintQr(selectedTable)}
                  className="flex-1 flex items-center justify-center gap-sm bg-primary text-on-primary font-semibold text-body-sm py-2 rounded-lg hover:bg-primary/95 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[18px]">print</span>
                  Print Card
                </button>
              </div>

              {/* Regenerate QR Placeholder */}
              <button
                disabled
                className="w-full py-2 border border-dashed border-surface-container text-on-surface-variant/40 font-semibold text-body-sm rounded-lg cursor-not-allowed flex items-center justify-center gap-sm opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">autorenew</span>
                Regenerate QR (Disabled)
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Floating Success Feedback Toast */}
      {toastMessage && (
        <div className="fixed bottom-lg right-lg z-[9999] bg-primary text-on-primary px-md py-sm rounded-lg shadow-lg flex items-center gap-sm animate-in fade-in slide-in-from-bottom-5 duration-200">
          <span className="material-symbols-outlined text-[20px] text-on-primary">check_circle</span>
          <span className="text-body-sm font-semibold">{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

// Single QrCodeCard Component to handle IntersectionObserver (Lazy loading)
interface QrCodeCardProps {
  table: QrTableRow;
  cachedQr: string | undefined;
  isLoadingQr: boolean;
  onLazyLoad: (tableId: string) => Promise<string | null>;
  onPreview: (table: QrTableRow) => void;
  onDownload: (table: QrTableRow) => void;
  onCopy: (url: string, tableNumber: number) => void;
  onPrint: (table: QrTableRow) => void;
}

const QrCodeCard: React.FC<QrCodeCardProps> = ({
  table,
  cachedQr,
  isLoadingQr,
  onLazyLoad,
  onPreview,
  onDownload,
  onCopy,
  onPrint,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [hasIntersected, setHasIntersected] = useState(false);

  // Set up IntersectionObserver
  useEffect(() => {
    if (hasIntersected) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setHasIntersected(true);
            onLazyLoad(table.id);
            observer.disconnect();
          }
        });
      },
      { rootMargin: "100px" } // trigger slightly before entering viewport
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [hasIntersected, table.id, onLazyLoad]);

  const handlePreviewClick = () => {
    // Make sure we trigger load immediately if it wasn't loaded yet
    if (!cachedQr && !isLoadingQr) {
      onLazyLoad(table.id);
    }
    onPreview(table);
  };

  const formattedNum = table.tableNumber < 10 ? `0${table.tableNumber}` : table.tableNumber;

  if (!table.isActive) {
    return (
      <div
        ref={cardRef}
        className="bg-surface border border-surface-container rounded-lg p-4 flex flex-col group opacity-85 transition-opacity"
      >
        {/* Card Header (Disabled Table) */}
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-title-sm font-semibold text-on-surface-variant">Table {formattedNum}</h3>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-semibold text-[10px] uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant"></span> Disabled
          </span>
        </div>

        {/* Faded QR Preview Container */}
        <div
          onClick={handlePreviewClick}
          className="w-full aspect-square bg-surface-container rounded-lg flex items-center justify-center mb-4 relative overflow-hidden opacity-50 grayscale cursor-pointer hover:opacity-60 transition-opacity"
        >
          {isLoadingQr ? (
            <div className="w-6 h-6 rounded-full border-2 border-on-surface-variant border-t-transparent animate-spin" />
          ) : cachedQr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`QR Code Disabled`}
              className="w-3/4 h-3/4 object-contain mix-blend-multiply"
              src={cachedQr}
            />
          ) : (
            <span className="material-symbols-outlined text-[36px] text-on-surface-variant/40">qr_code_2</span>
          )}
        </div>

        {/* Bottom Actions (Disabled) */}
        <div className="mt-auto pt-3 border-t border-surface-container-high flex justify-between items-center opacity-50 pointer-events-none">
          <div className="flex gap-1">
            <button className="w-8 h-8 rounded-lg text-on-surface-variant flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">image</span>
            </button>
            <button className="w-8 h-8 rounded-lg text-on-surface-variant flex items-center justify-center">
              <span className="material-symbols-outlined text-[18px]">content_copy</span>
            </button>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant font-semibold text-[11px] uppercase tracking-wider">
            <span className="material-symbols-outlined text-[16px]">print</span> Print
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className="bg-surface-container-lowest border border-surface-container rounded-lg p-4 flex flex-col group hover:shadow-md transition-shadow duration-300"
    >
      {/* Card Header (Active Table) */}
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-title-sm font-semibold text-on-surface">Table {formattedNum}</h3>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-active-accent text-on-active-accent font-semibold text-[10px] uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-on-active-accent"></span> Active
        </span>
      </div>

      {/* QR Code Container */}
      <div
        onClick={handlePreviewClick}
        className="w-full aspect-square bg-surface-container-low rounded-lg flex items-center justify-center mb-4 relative overflow-hidden group-hover:bg-surface-container transition-colors cursor-pointer"
        title="Click to zoom preview"
      >
        {isLoadingQr ? (
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        ) : cachedQr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`QR Code for Table ${table.tableNumber}`}
            className="w-3/4 h-3/4 object-contain mix-blend-multiply opacity-95 group-hover:scale-105 transition-transform duration-300"
            src={cachedQr}
          />
        ) : (
          <div className="flex flex-col items-center gap-xs">
            <span className="material-symbols-outlined text-[36px] text-on-surface-variant/40 animate-pulse">qr_code_2</span>
            <span className="text-[10px] text-on-surface-variant/40">Loading...</span>
          </div>
        )}
      </div>

      {/* Card Bottom Actions */}
      <div className="mt-auto pt-3 border-t border-surface-container-high flex justify-between items-center">
        <div className="flex gap-1">
          <button
            onClick={() => onDownload(table)}
            className="w-8 h-8 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-primary flex items-center justify-center transition-colors cursor-pointer"
            title="Download QR PNG"
          >
            <span className="material-symbols-outlined text-[18px]">image</span>
          </button>
          <button
            onClick={() => onCopy(table.guestUrl, table.tableNumber)}
            className="w-8 h-8 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-primary flex items-center justify-center transition-colors cursor-pointer"
            title="Copy Guest URL"
          >
            <span className="material-symbols-outlined text-[18px]">content_copy</span>
          </button>
        </div>
        <button
          onClick={() => onPrint(table)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-primary font-semibold text-[11px] uppercase tracking-wider hover:bg-surface-container-high transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[16px]">print</span> Print
        </button>
      </div>
    </div>
  );
};
