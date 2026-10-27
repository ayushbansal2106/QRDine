"use client";

import React, { useEffect, useMemo, useState } from "react";
import { MenuItem, MenuCategory, Table } from "@/types";
import { DishCard } from "@/components/customer/DishCard";
import { CategoryChips, CategoryChip } from "@/components/customer/CategoryChips";
import { CustomerHeader, CustomerCafe } from "@/components/customer/CustomerHeader";
import { CustomerSearchBar } from "@/components/customer/CustomerSearchBar";
import { SeatingCard } from "@/components/customer/SeatingCard";
import { DishOptionSheet } from "@/components/customer/DishOptionSheet";
import { CartSheet } from "@/components/customer/CartSheet";
import { SessionGate } from "@/components/menu/SessionGate";
import { StickyActionBar } from "@/components/layout/StickyActionBar";
import { WaiterAssistanceModal } from "@/components/WaiterAssistanceModal";
import { useCartStore } from "@/store/cartStore";
import { useSessionStore } from "@/store/sessionStore";
import { useStoresHydrated } from "@/store/useStoresHydrated";
import { fetchMyProfile, isCustomerSignedIn, updatePreferences } from "@/actions/customerApp";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/common/EmptyState";
import { GuestPrivacyNotice } from "@/components/common/GuestPrivacyNotice";
import { FssaiDisclaimer } from "@/components/common/FssaiDisclaimer";

interface TableMenuClientProps {
  table: Table;
  categories: MenuCategory[];
  items: MenuItem[];
  cafeId?: string;
  cafe?: CustomerCafe;
}

/**
 * Pure matchers, module-level so the memo dependencies below stay exhaustive.
 * Search spans name, description, ingredients, dietary tags and allergens so a
 * guest can search "vegan" or "nuts" and see what is safe to order.
 */
const matchesQuery = (item: MenuItem, query: string) => {
  if (query.length === 0) return true;
  const haystack = [
    item.name,
    item.description,
    ...(item.ingredients || []),
    ...(item.dietaryTags || []),
    ...(item.allergens || []),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
};

const matchesVeg = (item: MenuItem, vegOnly: boolean) =>
  !vegOnly || (item.dietaryTags || [])[0] === "veg";

export const TableMenuClient: React.FC<TableMenuClientProps> = ({
  table,
  categories,
  items,
  cafeId,
  cafe,
}) => {
  const { setTableId, setCafeId, getTotalItems } = useCartStore();
  const { sessionStatus } = useSessionStore();
  // The cart and session are persisted, so their values only exist on the
  // client after rehydration. Rendering them on the first pass would contradict
  // the empty server render and trip a hydration error.
  const storesHydrated = useStoresHydrated();
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [vegOnly, setVegOnly] = useState(false);
  // Module #09 — a signed-in guest's saved "veg only" preference applies to the
  // live menu, so it does not have to be re-set on every visit. The toggle
  // below stays available and overrides it for this visit.
  const [savedVegOnly, setSavedVegOnly] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const router = useRouter();
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);

  useEffect(() => {
    setTableId(table.id, table.tableNumber);
    setCafeId(cafeId || null);
  }, [table.id, table.tableNumber, cafeId, setTableId, setCafeId]);

  // Restore the guest's saved preferences once, on mount.
  useEffect(() => {
    let cancelled = false;
    isCustomerSignedIn().then(async (signedIn) => {
      if (cancelled) return;
      setIsSignedIn(signedIn);
      if (!signedIn) return;

      const { customer } = await fetchMyProfile();
      if (cancelled || !customer) return;
      setSavedVegOnly(Boolean(customer.preferences?.vegOnly));
      setVegOnly(Boolean(customer.preferences?.vegOnly));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the toggle so the choice survives to the next visit.
  const toggleVegOnly = async (next: boolean) => {
    setVegOnly(next);
    if (!isSignedIn || next === savedVegOnly) return;
    setSavedVegOnly(next);
    await updatePreferences({ vegOnly: next });
  };

  // Search spans name, description, ingredients, dietary tags and allergens so
  // a guest can search "vegan" or "nuts" and see what is safe to order.
  const query = searchQuery.trim().toLowerCase();

  const countsByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!matchesQuery(item, query) || !matchesVeg(item, vegOnly)) continue;
      const key = item.categoryId;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [items, query, vegOnly]);

  // "All" is always present so a guest can get back to the full menu once they
  // have drilled into a category.
  const chips: CategoryChip[] = useMemo(
    () => [
      { id: "all", name: "All", count: items.length },
      ...categories.map((c) => ({ id: c.id, name: c.name, count: countsByCategory.get(c.id) ?? 0 })),
    ],
    [categories, countsByCategory, items.length]
  );

  // Only offer categories that currently have matches, so a search never
  // presents a chip that leads to an empty section.
  const visibleChips = chips.filter(
    (chip) => chip.id === "all" || chip.count > 0 || chip.id === selectedCategory
  );

  const visibleItems = items.filter(
    (item) =>
      (selectedCategory === "all" || item.categoryId === selectedCategory) &&
      matchesQuery(item, query) &&
      matchesVeg(item, vegOnly)
  );

  // Group by category, preserving the café's declared category order.
  const sections = categories
    .map((category) => ({
      category,
      dishes: visibleItems.filter((item) => item.categoryId === category.id),
    }))
    .filter((section) => section.dishes.length > 0);

  const totalMatches = visibleItems.length;
  const isLive = storesHydrated && sessionStatus === "active";
  const cartCount = storesHydrated ? getTotalItems() : 0;

  return (
    <SessionGate tableId={table.id} cafeId={cafeId || ""}>
      <div className="min-h-screen flex flex-col bg-background pb-28">
        <CustomerHeader
          cafe={cafe ?? { name: "", logo: "", address: "" }}
          rating={null}
          cartCount={cartCount}
          onCallServer={() => setIsServerModalOpen(true)}
          onOpenCart={() => setIsCartOpen(true)}
          onOpenProfile={() => router.push("/profile")}
        />

        <main className="flex-1 w-full max-w-[1100px] mx-auto px-margin-mobile md:px-margin-desktop flex flex-col gap-md md:gap-lg py-md">
          {cafe?.isOrderingPaused && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center gap-3 text-amber-600 dark:text-amber-400">
              <span className="material-symbols-outlined text-[24px] shrink-0">pause_circle</span>
              <div className="flex-1">
                <p className="font-semibold text-body-md">Ordering is currently paused</p>
                <p className="text-body-sm opacity-90">
                  {cafe.orderingPausedReason || "The kitchen is temporarily pausing new digital orders. Please ask your server."}
                </p>
              </div>
            </div>
          )}

          <SeatingCard
            tableNumber={table.tableNumber}
            isLive={isLive}
            // Also derived from the persisted session: "Bill raised" versus
            // "Scanning" must not appear on a server render that never knew
            // a session existed.
            sessionStatus={storesHydrated ? sessionStatus : null}
          />

          <CustomerSearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            dishCount={items.length}
            vegOnly={vegOnly}
            onToggleVegOnly={() => toggleVegOnly(!vegOnly)}
          />

          <CategoryChips
            categories={visibleChips}
            selectedId={selectedCategory}
            onSelect={setSelectedCategory}
          />

          {totalMatches === 0 ? (
            <EmptyState
              title="No dishes found"
              description={
                searchQuery
                  ? `Nothing matches “${searchQuery}”. Try a different word${vegOnly ? " or turn off the veg filter" : ""}.`
                  : "No dishes match the current filter."
              }
              icon="search_off"
            />
          ) : (
            <div className="flex flex-col gap-lg md:gap-xl">
              {sections.map(({ category, dishes }) => (
                <section key={category.id} aria-labelledby={`sec-${category.id}`}>
                  <div className="flex items-center gap-sm mb-sm">
                    <h2
                      id={`sec-${category.id}`}
                      className="text-headline-sm md:text-headline-md font-semibold text-on-surface"
                    >
                      {category.name}
                    </h2>
                    <span className="text-[11px] uppercase tracking-wider text-on-surface-variant">
                      {dishes.length} {dishes.length === 1 ? "dish" : "dishes"}
                    </span>
                  </div>

                  {/* Mobile-first: one column of horizontal cards, widening to
                      two and three as the viewport allows. */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-gutter">
                    {dishes.map((item) => (
                      <DishCard
                        key={item.id}
                        item={item}
                        hydrated={storesHydrated}
                        onOpenDetail={setDetailItem}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          <div className="mt-xl flex flex-col gap-sm">
            <FssaiDisclaimer
              restaurantName={cafe?.name}
              legalName={cafe?.legalName}
              fssaiNumber={cafe?.fssaiNumber}
            />
            <GuestPrivacyNotice className="mb-lg" />
          </div>
        </main>

        <StickyActionBar tableId={table.id} onOpenCart={() => setIsCartOpen(true)} />
      </div>

      <DishOptionSheet
        key={detailItem?.id ?? "no-dish"}
        item={detailItem}
        onClose={() => setDetailItem(null)}
      />
      <CartSheet
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cafeName={cafe?.name ?? ""}
        tableNumber={table.tableNumber}
        isSignedIn={isSignedIn}
      />
      <WaiterAssistanceModal
        isOpen={isServerModalOpen}
        tableId={table.id}
        onClose={() => setIsServerModalOpen(false)}
      />
    </SessionGate>
  );
};

export default TableMenuClient;