"use client";
import { thrownMessage } from "@/lib/errorMessage";

import React, { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Table } from "@/types";
import { TopAppBar } from "@/components/layout/TopAppBar";
import { Button } from "@/components/common/Button";
import { Modal } from "@/components/common/Modal";
import { createTable, toggleTableActive, getTableQrAction } from "@/actions/tables";

interface TableManagementClientProps {
  initialTables: (Table & { isActive: boolean })[];
}

export const TableManagementClient: React.FC<TableManagementClientProps> = ({
  initialTables,
}) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // State management
  const [tables, setTables] = useState<(Table & { isActive: boolean })[]>(initialTables);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterOption, setFilterOption] = useState<"ALL" | "ACTIVE" | "DISABLED">("ALL");

  // Modals state
  const [isAddTableOpen, setIsAddTableOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [selectedTable, setSelectedTable] = useState<(Table & { isActive: boolean }) | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [isLoadingQr, setIsLoadingQr] = useState(false);

  // Forms state
  const [newTableNumber, setNewTableNumber] = useState("");

  // Create Table Handler
  const handleAddTableSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tableNum = parseInt(newTableNumber, 10);
    if (isNaN(tableNum) || tableNum <= 0) {
      alert("Please enter a valid table number greater than 0");
      return;
    }

    startTransition(async () => {
      try {
        const res = await createTable(tableNum);
        if (res.success && res.table) {
          const newTab = {
            ...res.table,
            isActive: true,
          };
          setTables((prev) => [...prev, newTab]);
          setIsAddTableOpen(false);
          setNewTableNumber("");
          router.refresh();
        }
      } catch (err: unknown) {
        alert(thrownMessage(err, "Failed to create table"));
      }
    });
  };

  // Toggle Enable/Disable table state
  const handleToggleTableState = (table: Table & { isActive: boolean }) => {
    const nextState = !table.isActive;
    const confirmMessage = nextState
      ? `Are you sure you want to enable Table ${table.tableNumber}?`
      : `Are you sure you want to disable Table ${table.tableNumber}? Guests will not be able to scan QR and order at this table.`;

    if (!confirm(confirmMessage)) return;

    startTransition(async () => {
      try {
        // Optimistic UI update
        setTables((prev) =>
          prev.map((t) => (t.id === table.id ? { ...t, isActive: nextState } : t))
        );

        await toggleTableActive(table.id, nextState);
        router.refresh();
      } catch (err: unknown) {
        // Rollback
        setTables((prev) =>
          prev.map((t) => (t.id === table.id ? { ...t, isActive: table.isActive } : t))
        );
        alert(thrownMessage(err, "Failed to update table status"));
      }
    });
  };

  // Fetch QR Code and open modal
  const handleOpenQrModal = async (table: Table & { isActive: boolean }) => {
    setSelectedTable(table);
    setIsQrModalOpen(true);
    setIsLoadingQr(true);
    setQrCodeDataUrl(null);

    try {
      const res = await getTableQrAction(table.id);
      if (res.success && res.qrDataUrl) {
        setQrCodeDataUrl(res.qrDataUrl);
      }
    } catch (err) {
      console.error("Failed to load QR code:", err);
      alert("Failed to load QR code from server");
    } finally {
      setIsLoadingQr(false);
    }
  };

  // Print QR card
  const handlePrintQr = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Print QR - Table ${selectedTable?.tableNumber}</title>
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
              border: 2px solid #51604f;
              border-radius: 20px;
              padding: 40px;
              text-align: center;
              max-width: 350px;
            }
            h1 { color: #51604f; font-size: 28px; margin-bottom: 5px; }
            p { color: #5e5e5b; font-size: 16px; margin-bottom: 20px; }
            img { width: 220px; height: 220px; }
          </style>
        </head>
        <body onload="window.print(); window.close();">
          <div class="card">
            <h1>QRDine Menu</h1>
            <p>Scan to view menu & order directly from your table</p>
            <img src="${qrCodeDataUrl}" alt="Table QR" />
            <h1>Table ${selectedTable?.tableNumber}</h1>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Download QR code image
  const handleDownloadQr = () => {
    if (!qrCodeDataUrl) return;
    const link = document.createElement("a");
    link.href = qrCodeDataUrl;
    link.download = `qrdine_table_${selectedTable?.tableNumber}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter and Search
  const filteredTables = tables.filter((table) => {
    const matchesSearch = String(table.tableNumber).includes(searchQuery);

    const matchesFilter =
      filterOption === "ALL" ||
      (filterOption === "ACTIVE" && table.isActive) ||
      (filterOption === "DISABLED" && !table.isActive);

    return matchesSearch && matchesFilter;
  });

  return (
    <div className="flex-1 flex flex-col bg-background pb-lg font-inter">
      {/* Top Header Bar */}
      <TopAppBar title="Table Management" iconName="table_restaurant" />

      {/* Main Canvas Area */}
      <main className="flex-1 p-margin-desktop overflow-y-auto">
        <div className="max-w-[1280px] mx-auto">
          {/* Section Heading & Actions */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-md mb-lg">
            <div>
              <h2 className="font-semibold text-headline-lg text-on-surface">Table Management</h2>
              <p className="text-body-md text-on-surface-variant mt-xs">
                Manage dining areas, statuses, and generate QR codes.
              </p>
            </div>
            <div className="flex gap-sm">
              <Button
                variant="primary"
                onClick={() => setIsAddTableOpen(true)}
                className="h-10 px-md"
              >
                <span className="material-symbols-outlined text-[18px]">add</span>
                Add Table
              </Button>
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
                Active ({tables.filter((t) => t.isActive).length})
              </button>
              <button
                onClick={() => setFilterOption("DISABLED")}
                className={`px-md py-1.5 rounded-full text-body-sm font-semibold transition-colors cursor-pointer ${
                  filterOption === "DISABLED"
                    ? "bg-surface-container-high text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-container-low"
                }`}
              >
                Disabled ({tables.filter((t) => !t.isActive).length})
              </button>
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
                placeholder="Search tables..."
                type="text"
              />
            </div>
          </div>

          {/* Grid Layout */}
          {filteredTables.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-gutter pb-xl">
              {filteredTables.map((table) => (
                <div
                  key={table.id}
                  className="bg-surface-container-lowest rounded-xl border border-surface-container flex flex-col hover:shadow-[0px_10px_24px_rgba(0,0,0,0.04)] transition-all duration-200 overflow-hidden group relative min-h-[160px]"
                >
                  <div className="p-sm flex-1 flex flex-col relative">
                    {/* Status accent border on left */}
                    <div
                      className={`absolute top-0 left-0 w-1 h-full transition-colors ${
                        table.isActive ? "bg-primary-container" : "bg-error/40"
                      }`}
                    />

                    {/* Table Title and Status Badge */}
                    <div className="flex justify-between items-start mb-sm pl-xs">
                      <div>
                        <h3 className="font-semibold text-title-sm text-on-surface">
                          Table {table.tableNumber}
                        </h3>
                        <p className="text-body-sm text-on-surface-variant/60">
                          {table.isActive ? "Main Dining" : "Inactive"}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center px-sm py-0.5 rounded text-label-sm font-semibold transition-colors ${
                          table.isActive
                            ? "bg-tertiary-container text-on-tertiary-container"
                            : "bg-error-container text-on-error-container"
                        }`}
                      >
                        {table.isActive ? "Active" : "Disabled"}
                      </span>
                    </div>

                    {/* Quick Helper Text */}
                    <div className="mt-auto pl-xs flex flex-col items-center justify-center py-2 border border-dashed border-surface-container rounded-lg opacity-60 bg-surface-container-low/20">
                      <span className="material-symbols-outlined text-[20px] text-on-surface-variant/50">
                        qr_code_2
                      </span>
                      <span className="text-[11px] text-on-surface-variant">
                        {table.isActive ? "Scan to view menu" : "Orders blocked"}
                      </span>
                    </div>
                  </div>

                  {/* Actions Bar */}
                  <div className="border-t border-surface-container p-xs flex justify-between items-center bg-surface-container-low/10 px-sm">
                    {/* Toggle Switch to Quick Enable/Disable */}
                    <label className="flex items-center gap-xs cursor-pointer" title={table.isActive ? "Disable Table" : "Enable Table"}>
                      <input
                        type="checkbox"
                        checked={table.isActive}
                        onChange={() => handleToggleTableState(table)}
                        className="sr-only peer"
                        disabled={isPending}
                      />
                      <div className="w-8 h-4 bg-surface-container peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-surface-container after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-primary relative"></div>
                    </label>

                    {/* QR and View Controls */}
                    <div className="flex gap-xs">
                      {table.isActive && (
                        <button
                          onClick={() => handleOpenQrModal(table)}
                          className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-surface-container rounded-lg transition-colors cursor-pointer"
                          title="View/Print QR"
                        >
                          <span className="material-symbols-outlined text-[18px]">print</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-xl bg-surface-container-lowest border border-surface-container rounded-xl text-on-surface-variant/40">
              No tables found matching your search.
            </div>
          )}
        </div>
      </main>

      {/* Add Table Modal */}
      <Modal isOpen={isAddTableOpen} onClose={() => setIsAddTableOpen(false)} title="Add New Table">
        <form onSubmit={handleAddTableSubmit} className="flex flex-col gap-sm">
          <div className="flex flex-col gap-xs">
            <label className="font-semibold text-label-md text-on-surface">Table Number</label>
            <input
              required
              type="number"
              min="1"
              value={newTableNumber}
              onChange={(e) => setNewTableNumber(e.target.value)}
              className="bg-surface-container-low rounded-lg p-sm border-none text-body-md text-on-surface placeholder-on-surface-variant/40 focus:ring-1 focus:ring-primary outline-none"
              placeholder="e.g. 15"
            />
          </div>
          <div className="flex justify-end gap-sm mt-sm">
            <Button variant="ghost" onClick={() => setIsAddTableOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Adding..." : "Add Table"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* View QR Code Modal */}
      <Modal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        title={`QR Code - Table ${selectedTable?.tableNumber}`}
      >
        <div className="flex flex-col items-center justify-center p-sm gap-md">
          {isLoadingQr ? (
            <div className="flex flex-col items-center justify-center py-xl gap-sm">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
              <span className="text-body-sm text-on-surface-variant">Generating QR code...</span>
            </div>
          ) : qrCodeDataUrl ? (
            <div className="flex flex-col items-center gap-md">
              {/* QR Preview Card */}
              <div className="border border-surface-container rounded-2xl p-md text-center max-w-[280px] bg-white shadow-sm flex flex-col items-center">
                <span className="font-semibold text-headline-md text-primary mb-xs select-none">
                  QRDine Menu
                </span>
                <span className="text-body-sm text-on-surface-variant mb-sm">
                  Scan to order directly from table
                </span>
                <Image
                  src={qrCodeDataUrl}
                  alt="Table QR Code"
                  className="w-48 h-48 border border-surface-container p-xs rounded-lg"
                  width={192}
                  height={192}
                  unoptimized
                />
                <span className="font-bold text-headline-lg text-primary mt-sm">
                  Table {selectedTable?.tableNumber}
                </span>
              </div>

              {/* Actions */}
              <div className="flex gap-sm w-full">
                <Button variant="secondary" onClick={handleDownloadQr} className="flex-1">
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  Download
                </Button>
                <Button variant="primary" onClick={handlePrintQr} className="flex-1">
                  <span className="material-symbols-outlined text-[18px]">print</span>
                  Print
                </Button>
              </div>
            </div>
          ) : (
            <span className="text-body-sm text-error">Failed to generate QR Code.</span>
          )}
        </div>
      </Modal>
    </div>
  );
};
export default TableManagementClient;
