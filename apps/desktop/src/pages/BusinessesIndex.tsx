import { useState } from "react";
import { Link } from "react-router-dom";
import { PageContainer, Hero, SectionTitle, EmptyState } from "@/components/page";
import { useLedger, domainMetrics, formatMoney, convert, domainDisplayCurrency } from "@/lib/ledger";
import { Plus, ArrowUpRight } from "lucide-react";
import { QuickCreateDialog, type QuickKind } from "@/components/quick-create";

export default function BusinessesIndex() {
  const { state } = useLedger();
  const [quickKind, setQuickKind] = useState<QuickKind | null>(null);
  const businesses = state.domains.filter((d) => d.kind === "business" || d.kind === "trading");

  return (
    <PageContainer>
      <Hero
        eyebrow="Workspace"
        title="Businesses"
        description="Every venture is its own domain with its own books — while remaining part of the same ledger."
        actions={
          <button
            type="button"
            onClick={() => setQuickKind("business")}
            className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1.5"
          >
            <Plus className="size-3.5" /> New Business
          </button>
        }
      />
      <SectionTitle>All Businesses</SectionTitle>
      {businesses.length === 0 ? (
        <EmptyState
          title="No businesses yet"
          description="Add a business or trading domain to keep its books separate from Personal."
          action={
            <button
              type="button"
              onClick={() => setQuickKind("business")}
              className="text-sm border border-border rounded-md px-3 py-1.5 hover:bg-accent inline-flex items-center gap-1.5"
            >
              <Plus className="size-3.5" /> New Business
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {businesses.map((d) => {
            const m = domainMetrics(state, d.id);
            const ddc = domainDisplayCurrency(state, d.id);
            const disp = (u: number) => formatMoney(convert(state, u, "USD", ddc), ddc, { compact: true });
            return (
              <Link key={d.id} to={`/businesses/${d.id}`} className="group border border-border rounded-lg bg-card p-4 hover:border-foreground/20 transition-colors">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{d.kind}</div>
                    <div className="font-medium">{d.name}</div>
                  </div>
                  <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-foreground" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Net Worth</div>
                    <div className="num text-sm font-medium">{disp(m.netWorth)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Cash</div>
                    <div className="num text-sm font-medium">{disp(m.liquid)}</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <QuickCreateDialog kind={quickKind} onClose={() => setQuickKind(null)} />
    </PageContainer>
  );
}
