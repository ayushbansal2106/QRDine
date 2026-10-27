"use client";

import React, { useCallback, useState } from "react";
import {
  createNfcTag,
  deleteNfcTag,
  getNfcTagCard,
  updateNfcTag,
} from "@/actions/nfc";
import type { NfcDestination, NfcStats, NfcTag, NfcTagCard, Table } from "@/types";
import { formatDateTime } from "@/lib/format";
import { thrownMessage } from "@/lib/errorMessage";

interface Props {
  initialTags: NfcTag[];
  initialStats: NfcStats | null;
  tables: Table[];
  loadError: string | null;
}

type NdefReaderLike = {
  write: (options: { records: { recordType: string; data?: string; mediaType?: string }[] }) => Promise<void>;
};

const DESTINATIONS: { value: NfcDestination; label: string; hint: string }[] = [
  { value: "menu", label: "Table menu", hint: "Tap opens the guest menu for the bound table" },
  { value: "google_review", label: "Google review", hint: "Tap opens Google's write-a-review dialog" },
  { value: "instagram", label: "Instagram", hint: "Tap opens the cafe's Instagram profile" },
  { value: "custom", label: "Custom URL", hint: "Tap opens any URL you control" },
];

/**
 * Web NFC types are not in the default TS lib, so the minimum surface we use is
 * declared here rather than pulling in a global augmentation file.
 */
interface WebNfcCapable {
  NDEFReader?: new () => NdefReaderLike;
}

const supportsWebNfc = (): boolean =>
  typeof window !== "undefined" && typeof (navigator as unknown as WebNfcCapable).NDEFReader !== "undefined";

export const NfcManagerClient: React.FC<Props> = ({ initialTags, initialStats, tables, loadError }) => {
  const [tags, setTags] = useState<NfcTag[]>(initialTags);
  const [stats, setStats] = useState<NfcStats | null>(initialStats);
  const [label, setLabel] = useState("");
  const [destination, setDestination] = useState<NfcDestination>("menu");
  const [targetUrl, setTargetUrl] = useState("");
  const [tableId, setTableId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [card, setCard] = useState<{ tag: NfcTag; card: NfcTagCard } | null>(null);
  const [writingTagId, setWritingTagId] = useState<string | null>(null);

  // Web NFC availability is a property of the browser, not of this component's
  // state — it cannot change while the page is open, so it is read on each
  // render (guarded for the server) instead of being latched into state by an
  // effect. Latching it meant the capability rendered one tick late.
  const webNfcAvailable = supportsWebNfc();

  const refresh = useCallback(async () => {
    const { getNfcTags } = await import("@/actions/nfc");
    const result = await getNfcTags();
    if (result.success && result.tags) {
      setTags(result.tags);
      setStats(result.stats ?? null);
    }
  }, []);

  const createTag = async () => {
    setBusy(true);
    setMessage(null);
    const result = await createNfcTag({
      label: label.trim(),
      destination,
      targetUrl: destination === "custom" ? targetUrl.trim() : "",
      tableId: tableId || null,
      notes: notes.trim(),
    });
    setBusy(false);
    if (!result.success || !result.tag || !result.card) {
      setMessage({ tone: "error", text: result.message || "Could not create the tag." });
      return;
    }
    setTags((prev) => [result.tag as NfcTag, ...prev]);
    setCard({ tag: result.tag, card: result.card });
    setLabel("");
    setTargetUrl("");
    setNotes("");
    setMessage({
      tone: "success",
      text: "Tag created. Print the sticker, then write it to the physical tag below.",
    });
  };

  const openCard = async (tag: NfcTag) => {
    const result = await getNfcTagCard(tag.id);
    if (result.success && result.card) setCard({ tag, card: result.card });
    else setMessage({ tone: "error", text: result.message || "Could not build the sticker." });
  };

  const toggleActive = async (tag: NfcTag) => {
    const result = await updateNfcTag(tag.id, { isActive: !tag.isActive });
    if (result.success) {
      setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, isActive: !t.isActive } : t)));
    } else {
      setMessage({ tone: "error", text: result.message || "Could not update the tag." });
    }
  };

  const removeTag = async (tag: NfcTag) => {
    const result = await deleteNfcTag(tag.id);
    if (result.success) {
      setTags((prev) => prev.filter((t) => t.id !== tag.id));
      if (card?.tag.id === tag.id) setCard(null);
    } else {
      setMessage({ tone: "error", text: result.message || "Could not delete the tag." });
    }
  };

  /** Write the resolver URL into a physical tag (Android Chrome with Web NFC). */
  const writeToPhysicalTag = async (tag: NfcTag) => {
    setMessage(null);
    const NDEFReader = (navigator as unknown as WebNfcCapable).NDEFReader;
    if (!NDEFReader) {
      setMessage({
        tone: "error",
        text: "This browser cannot write to NFC tags. Use the QR code or copy the payload URL onto the tag with a tag writer app.",
      });
      return;
    }

    setWritingTagId(tag.id);
    try {
      const reader = new NDEFReader();
      await reader.write({
        records: [{ recordType: "url", data: tag.payloadUrl }],
      });
      setMessage({ tone: "success", text: "Tag written. Tap a phone against it to verify." });
    } catch (err: unknown) {
      // `NDEFReader.write` rejects with a DOMException; "NotAllowedError" means
      // the user dismissed the permission prompt or moved the tag out of range,
      // which is worth a targeted instruction rather than the raw message.
      const isNotAllowed =
        typeof DOMException !== "undefined" &&
        err instanceof DOMException &&
        err.name === "NotAllowedError";
      setMessage({
        tone: "error",
        text: isNotAllowed
          ? "Tag write cancelled. Hold the tag still against the phone and try again."
          : thrownMessage(err, "Could not write to the tag."),
      });
    } finally {
      setWritingTagId(null);
    }
  };

  return (
    <div className="p-lg bg-surface-container-lowest min-h-screen font-inter">
      <div className="max-w-6xl mx-auto flex flex-col gap-lg">
        <header>
          <h1 className="text-headline-lg text-on-surface font-semibold">NFC Tags</h1>
          <p className="text-body-sm text-on-surface-variant mt-xs max-w-3xl">
            Each sticker carries a resolver URL, never the menu link itself. Repoint a tag here and the
            physical sticker changes behaviour immediately — no re-printing. Every sticker is printed
            with a QR code of the same URL, so guests on a phone without NFC (or who decline the
            permission prompt) can still scan.
          </p>
        </header>

        {loadError && <div className="bg-error/10 text-error rounded-xl p-md text-body-md">{loadError}</div>}
        {message && (
          <div
            className={`rounded-xl p-md text-body-md ${
              message.tone === "success" ? "bg-primary/10 text-primary" : "bg-error/10 text-error"
            }`}
          >
            {message.text}
          </div>
        )}

        <section className="grid grid-cols-2 md:grid-cols-4 gap-md">
          {[
            { label: "Tags", value: stats?.total ?? tags.length, icon: "contactless" },
            { label: "Active", value: stats?.active ?? 0, icon: "check_circle" },
            { label: "Total taps", value: stats?.totalTaps ?? 0, icon: "touch_app" },
            {
              label: "Last tap",
              value: stats?.lastTapAt ? formatDateTime(stats.lastTapAt, "never") : "never",
              icon: "schedule",
            },
          ].map((s) => (
            <div key={s.label} className="bg-surface-container-lowest border border-surface-container rounded-xl p-md flex items-center gap-md">
              <span className="material-symbols-outlined text-[26px] text-primary">{s.icon}</span>
              <div className="flex flex-col min-w-0">
                <span className="text-body-sm text-on-surface-variant">{s.label}</span>
                <span className="text-body-lg font-bold text-on-surface font-mono truncate">{s.value}</span>
              </div>
            </div>
          ))}
        </section>

        {!webNfcAvailable && (
          <div className="bg-surface-container rounded-xl p-md text-body-sm text-on-surface-variant">
            <span className="material-symbols-outlined text-[18px] align-middle mr-xs">info</span>
            This browser cannot write NFC tags directly (Web NFC is Android Chrome only). Provisioning
            still works: print the QR below, and write the payload URL onto the tag with any NDEF tag
            writer app. Both paths produce the same sticker.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-lg">
          <section className="bg-surface-container-lowest border border-surface-container rounded-xl p-lg">
            <h2 className="text-title-lg text-on-surface font-semibold mb-md">New tag</h2>

            <div className="flex flex-col gap-md">
              <div className="flex flex-col gap-xs">
                <label className="text-label-md text-on-surface-variant" htmlFor="nfc-label">
                  Label (where is this sticker?)
                </label>
                <input
                  id="nfc-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Table 4 tent card"
                  className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
                />
              </div>

              <div className="flex flex-col gap-xs">
                <label className="text-label-md text-on-surface-variant" htmlFor="nfc-destination">
                  Tap destination
                </label>
                <select
                  id="nfc-destination"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value as NfcDestination)}
                  className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
                >
                  {DESTINATIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <span className="text-body-sm text-on-surface-variant">
                  {DESTINATIONS.find((d) => d.value === destination)?.hint}
                </span>
              </div>

              {destination === "menu" && (
                <div className="flex flex-col gap-xs">
                  <label className="text-label-md text-on-surface-variant" htmlFor="nfc-table">
                    Bind to table
                  </label>
                  <select
                    id="nfc-table"
                    value={tableId}
                    onChange={(e) => setTableId(e.target.value)}
                    className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
                  >
                    <option value="">No table (cafe-wide menu link)</option>
                    {tables.map((t) => (
                      <option key={t.id} value={t.id}>
                        Table {t.tableNumber}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {destination === "custom" && (
                <div className="flex flex-col gap-xs">
                  <label className="text-label-md text-on-surface-variant" htmlFor="nfc-url">
                    Target URL
                  </label>
                  <input
                    id="nfc-url"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="https://instagram.com/yourcafe"
                    className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
                  />
                </div>
              )}

              <div className="flex flex-col gap-xs">
                <label className="text-label-md text-on-surface-variant" htmlFor="nfc-notes">
                  Notes
                </label>
                <input
                  id="nfc-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="border border-surface-container rounded-lg px-sm py-sm text-body-md bg-surface-container-lowest"
                />
              </div>

              <button
                onClick={createTag}
                disabled={busy || (destination === "custom" && !targetUrl.trim())}
                className="self-start bg-primary text-on-primary rounded-full px-lg py-sm text-body-md font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create tag"}
              </button>
            </div>
          </section>

          <section className="bg-surface-container-lowest border border-surface-container rounded-xl p-lg">
            <h2 className="text-title-lg text-on-surface font-semibold mb-md">Sticker</h2>
            {!card ? (
              <p className="text-body-md text-on-surface-variant">
                Select a tag below and press &ldquo;Print sticker&rdquo; to get the QR, the payload URL and
                the write button.
              </p>
            ) : (
              <div className="flex flex-col gap-md">
                <div className="flex items-start gap-md">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.card.qrDataUrl}
                    alt={`QR code for tag ${card.card.tagId}`}
                    className="w-40 h-40 rounded-lg border border-surface-container bg-white p-xs"
                  />
                  <div className="flex flex-col gap-xs text-body-sm min-w-0">
                    <span className="font-mono font-semibold">{card.card.tagId}</span>
                    <span className="text-on-surface-variant">resolves to: {card.card.resolvesTo}</span>
                    {card.card.destinationUrl && (
                      <span className="text-on-surface-variant break-all font-mono text-label-sm">
                        {card.card.destinationUrl}
                      </span>
                    )}
                    <button
                      onClick={() => navigator.clipboard?.writeText(card.card.payloadUrl)}
                      className="self-start text-primary font-semibold hover:underline"
                    >
                      Copy payload URL
                    </button>
                  </div>
                </div>

                <div className="bg-surface-container rounded-lg p-sm">
                  <p className="text-label-sm text-on-surface-variant mb-xs">NDEF URI record</p>
                  <code className="text-label-md font-mono break-all">{card.card.payloadUrl}</code>
                </div>

                <div className="flex flex-wrap gap-sm">
                  <button
                    onClick={() => writeToPhysicalTag(card.tag)}
                    disabled={writingTagId === card.tag.id}
                    className="bg-primary text-on-primary rounded-full px-md py-sm text-body-md font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    {writingTagId === card.tag.id ? "Hold the tag still…" : "Write to physical tag"}
                  </button>
                  <button
                    onClick={() => window.open(card.card.destinationUrl || card.card.payloadUrl, "_blank")}
                    className="border border-surface-container rounded-full px-md py-sm text-body-md font-semibold hover:bg-surface-container"
                  >
                    Test the tap
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        <section className="bg-surface-container-lowest border border-surface-container rounded-xl p-lg">
          <div className="flex items-center justify-between mb-md">
            <h2 className="text-title-lg text-on-surface font-semibold">Tags</h2>
            <button onClick={refresh} className="text-body-sm text-primary font-semibold hover:underline">
              Refresh
            </button>
          </div>

          {tags.length === 0 ? (
            <p className="text-body-md text-on-surface-variant">No tags yet. Create your first one above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-body-md">
                <thead>
                  <tr className="text-left text-label-md text-on-surface-variant border-b border-surface-container">
                    <th className="py-sm">Tag</th>
                    <th>Label</th>
                    <th>Destination</th>
                    <th>Table</th>
                    <th>Taps</th>
                    <th>Last tap</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tags.map((tag) => (
                    <tr key={tag.id} className="border-b border-surface-container/60">
                      <td className="py-sm font-mono text-body-sm">{tag.tagId}</td>
                      <td>{tag.label || "—"}</td>
                      <td className="capitalize">{tag.destination}</td>
                      <td>{tag.tableNumber ?? "—"}</td>
                      <td className="font-mono">{tag.tapCount}</td>
                      <td className="text-body-sm text-on-surface-variant">
                        {tag.lastTapAt ? formatDateTime(tag.lastTapAt, "never") : "never"}
                      </td>
                      <td>
                        <div className="flex justify-end gap-xs">
                          <button
                            onClick={() => openCard(tag)}
                            className="text-body-sm text-primary font-semibold hover:underline"
                          >
                            Sticker
                          </button>
                          <button
                            onClick={() => toggleActive(tag)}
                            className="text-body-sm text-on-surface-variant hover:underline"
                          >
                            {tag.isActive ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => removeTag(tag)}
                            className="text-body-sm text-error hover:underline"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};