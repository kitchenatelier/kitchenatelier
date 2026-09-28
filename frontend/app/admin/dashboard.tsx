import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Linking, Platform, TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { api, tokenStore } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

const STATUS_TILES = [
  { label: "Order Received", color: "#F4DFD7" },
  { label: "Under Review", color: "#F4DFD7" },
  { label: "Confirmed", color: "#FDE8CE" },
  { label: "Preparing", color: "#FDE8CE" },
  { label: "Ready for Delivery", color: "#FDE8CE" },
  { label: "Dispatched", color: "#DCEAE0" },
  { label: "Delivered", color: "#DCEAE0" },
  { label: "Completed", color: "#DCEAE0" },
  { label: "Cancelled", color: "#F5D8D8" },
];

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString(undefined, { month: "short" });
};

const today = () => new Date().toISOString().slice(0, 10);

export default function AdminDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  const summary = useQuery({ queryKey: ["dashboard"], queryFn: () => api.dashboardSummary() });
  const recent = useQuery({ queryKey: ["orders-admin", ""], queryFn: () => api.listOrders() });
  const [months, setMonths] = useState(1);
  const insights = useQuery({ queryKey: ["top-customers", months], queryFn: () => api.topCustomers(months) });
  const sales = useQuery({ queryKey: ["sales-monthly", 6], queryFn: () => api.salesMonthly(6) });
  const sold = useQuery({ queryKey: ["products-sold"], queryFn: () => api.productsSold() });

  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [fromDate, setFromDate] = useState(today());
  const [toDate, setToDate] = useState(today());

  const counts = summary.data?.counts || {};
  const topList = insights.data?.customers || [];

  const maxRevenue = useMemo(() => {
    const s = sales.data?.series || [];
    return Math.max(1, ...s.map(x => x.revenue));
  }, [sales.data]);

  const downloadCsv = async (url: string, filename: string) => {
    setExporting(true);
    try {
      const token = await tokenStore.get();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (Platform.OS === "web") {
        const objectUrl = URL.createObjectURL(blob);
        const a = (window as any).document.createElement("a");
        a.href = objectUrl; a.download = filename;
        (window as any).document.body.appendChild(a); a.click(); a.remove();
        toast.show("CSV downloaded", "success");
      } else {
        const reader = new FileReader();
        reader.onloadend = () => Linking.openURL(reader.result as string).catch(() => toast.show("Open on web to download", "info"));
        reader.readAsDataURL(blob);
      }
    } catch (e: any) {
      toast.show(e.message || "Export failed", "error");
    } finally { setExporting(false); }
  };

  const validateRange = () => {
    const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!isDate(fromDate) || !isDate(toDate)) {
      toast.show("Use format YYYY-MM-DD", "error"); return false;
    }
    if (fromDate > toDate) {
      toast.show("From must be on/before To", "error"); return false;
    }
    return true;
  };

  const exportOrdersRange = () => {
    if (!validateRange()) return;
    downloadCsv(api.ordersCsvUrl(fromDate, toDate), `orders-${fromDate}_${toDate}.csv`);
  };
  const exportProductsSoldRange = () => {
    if (!validateRange()) return;
    downloadCsv(api.productsSoldCsvUrl(fromDate, toDate), `products-sold-${fromDate}_${toDate}.csv`);
  };
  const exportTodayOrders = () => downloadCsv(api.ordersCsvUrl(), "orders-today.csv");

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Admin Dashboard</Text>
        <Text style={styles.sub}>Total orders: {summary.data?.total ?? 0}</Text>
        {summary.data && (summary.data.overdue_count > 0 || summary.data.unpaid_total > 0) && (
          <View style={styles.alertRow}>
            <Text style={styles.alertText}>
              {summary.data.overdue_count > 0
                ? `${summary.data.overdue_count} invoice${summary.data.overdue_count === 1 ? "" : "s"} overdue`
                : "All invoices on time"}
              {summary.data.unpaid_total > 0 ? ` · Unpaid RM ${summary.data.unpaid_total.toFixed(2)}` : ""}
            </Text>
          </View>
        )}
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl
            refreshing={summary.isFetching || recent.isFetching || insights.isFetching || sales.isFetching || sold.isFetching}
            onRefresh={() => { summary.refetch(); recent.refetch(); insights.refetch(); sales.refetch(); sold.refetch(); }}
            tintColor={colors.brandPrimary}
          />
        }
      >
        <View style={styles.grid}>
          {STATUS_TILES.map(s => (
            <Pressable
              key={s.label}
              testID={`tile-${s.label}`}
              style={[styles.tile, { backgroundColor: s.color }]}
              onPress={() => router.push({ pathname: "/admin/orders", params: { status: s.label } })}
            >
              <Text style={styles.tileCount}>{counts[s.label] || 0}</Text>
              <Text style={styles.tileLabel}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Sales chart */}
        <View style={styles.card}>
          <Text style={styles.section}>Monthly sales (last 6 months)</Text>
          <View style={styles.chartBox}>
            {(sales.data?.series || []).map((b) => {
              const heightPct = maxRevenue > 0 ? (b.revenue / maxRevenue) : 0;
              return (
                <View key={b.month} style={styles.chartCol} testID={`sales-bar-${b.month}`}>
                  <Text style={styles.barValue}>{b.revenue > 0 ? `RM ${Math.round(b.revenue)}` : ""}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { height: `${Math.max(4, heightPct * 100)}%` }]} />
                  </View>
                  <Text style={styles.barLabel}>{monthLabel(b.month)}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* What sold this month */}
        <View style={styles.card}>
          <Text style={styles.section}>What sold this month</Text>
          <Text style={styles.hint}>{sold.data ? `${sold.data.total_units} units · RM ${sold.data.total_revenue.toFixed(2)}` : "..."}</Text>
          {(sold.data?.rows || []).length === 0 ? (
            <Text style={styles.empty} testID="sold-empty">No sales yet this month</Text>
          ) : (
            (sold.data!.rows).slice(0, 10).map((r, i) => (
              <View key={`${r.sku}-${r.variation}-${i}`} style={styles.itemRow} testID={`sold-${r.sku}-${r.variation || "base"}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{r.product_name}{r.variation ? ` — ${r.variation}` : ""}</Text>
                  <Text style={styles.itemMeta}>{r.sku} · {r.units} {r.unit} · {r.orders_count} order{r.orders_count === 1 ? "" : "s"}</Text>
                </View>
                <Text style={styles.custAmount}>RM {r.revenue.toFixed(2)}</Text>
              </View>
            ))
          )}
        </View>

        {/* Exports */}
        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.section}>Exports</Text>
            <Pressable
              testID="export-toggle-range"
              onPress={() => setExportOpen(v => !v)}
              style={styles.linkBtn}
            >
              <Text style={{ color: colors.brandPrimary, fontSize: 13 }}>{exportOpen ? "Hide range" : "Custom range"}</Text>
            </Pressable>
          </View>
          <Button
            testID="export-today-csv"
            title={exporting ? "Preparing..." : "Export today's orders (CSV)"}
            onPress={exportTodayOrders}
            loading={exporting}
            variant="secondary"
            style={{ marginTop: spacing.sm }}
          />
          {exportOpen && (
            <View style={{ marginTop: spacing.sm }}>
              <View style={styles.rangeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hint}>From (YYYY-MM-DD)</Text>
                  <TextInput
                    testID="range-from"
                    style={styles.input}
                    value={fromDate}
                    onChangeText={setFromDate}
                    placeholder="2026-09-01"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hint}>To (YYYY-MM-DD)</Text>
                  <TextInput
                    testID="range-to"
                    style={styles.input}
                    value={toDate}
                    onChangeText={setToDate}
                    placeholder={today()}
                    placeholderTextColor={colors.muted}
                    autoCapitalize="none"
                  />
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <Button testID="export-orders-range" title="Orders CSV" onPress={exportOrdersRange} loading={exporting} variant="secondary" style={{ flex: 1 }} />
                <Button testID="export-products-sold-range" title="Products sold CSV" onPress={exportProductsSoldRange} loading={exporting} variant="secondary" style={{ flex: 1 }} />
              </View>
            </View>
          )}
        </View>

        {/* Top wholesalers */}
        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.section}>Top wholesalers</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[1, 3, 6].map(m => (
                <Pressable
                  key={m}
                  testID={`insights-months-${m}`}
                  onPress={() => setMonths(m)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
                    backgroundColor: months === m ? colors.brandPrimary : colors.surface,
                    borderWidth: 1, borderColor: months === m ? colors.brandPrimary : colors.border,
                  }}
                >
                  <Text style={{ fontSize: 11, color: months === m ? colors.onBrandPrimary : colors.onSurface }}>
                    {m === 1 ? "This month" : `${m} months`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
          {topList.length === 0 ? (
            <Text style={styles.empty} testID="top-customers-empty">No orders yet in this range</Text>
          ) : (
            topList.map((c: any, idx: number) => (
              <Pressable
                key={c.customer_id}
                testID={`top-customer-${c.email}`}
                onPress={() => router.push(`/admin/customer/${c.customer_id}`)}
                style={styles.insightRow}
              >
                <View style={styles.rank}><Text style={styles.rankText}>{idx + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.custName}>{c.company || c.name || c.email}</Text>
                  <Text style={styles.custMeta}>
                    {c.orders_count} order{c.orders_count === 1 ? "" : "s"} · {c.total_units} units
                    {c.last_order_at ? ` · last ${new Date(c.last_order_at).toLocaleDateString()}` : ""}
                  </Text>
                </View>
                <Text style={styles.custAmount}>RM {c.total_amount.toFixed(2)}</Text>
              </Pressable>
            ))
          )}
        </View>

        <Text style={styles.section}>Recent orders</Text>
        {(recent.data || []).slice(0, 10).map(o => (
          <Pressable
            key={o.id}
            testID={`admin-recent-${o.order_number}`}
            style={styles.card2}
            onPress={() => router.push(`/admin/order/${o.id}`)}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.num}>{o.order_number}</Text>
              <Text style={styles.status}>{o.status}</Text>
            </View>
            <Text style={styles.meta}>{o.customer_company || o.customer_name} · {o.items.length} items</Text>
            <Text style={styles.meta}>{new Date(o.created_at).toLocaleString()}</Text>
            <Text style={styles.total}>RM {o.total_amount.toFixed(2)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface },
  sub: { color: colors.muted, marginTop: 2 },
  alertRow: { backgroundColor: colors.brandTertiary, borderRadius: radius.sm, padding: spacing.sm, marginTop: spacing.sm },
  alertText: { color: colors.onBrandTertiary, fontSize: 12, fontWeight: "500" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  tile: { width: "31%", padding: spacing.md, borderRadius: radius.md, minHeight: 76 },
  tileCount: { fontSize: 20, fontWeight: "700", color: colors.onSurface },
  tileLabel: { fontSize: 11, color: colors.onSurface, marginTop: 2 },
  section: { fontSize: 16, fontWeight: "600", color: colors.onSurface, marginBottom: 6 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  card2: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  num: { fontWeight: "600", color: colors.onSurface },
  status: { color: colors.brandPrimary, fontWeight: "500" },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  total: { color: colors.brandPrimary, fontWeight: "600", marginTop: 4 },
  hint: { color: colors.muted, fontSize: 12 },
  insightRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: 8 },
  rank: { width: 24, height: 24, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  rankText: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: 12 },
  custName: { fontWeight: "600", color: colors.onSurface },
  custMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  custAmount: { color: colors.brandPrimary, fontWeight: "700" },
  empty: { color: colors.muted, fontStyle: "italic", paddingVertical: spacing.sm },
  itemRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider, alignItems: "center" },
  name: { color: colors.onSurface, fontWeight: "500", fontSize: 14 },
  itemMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 40, color: colors.onSurface, fontSize: 13, paddingVertical: 8, marginTop: 4 },
  rangeRow: { flexDirection: "row", gap: 8 },
  linkBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  chartBox: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 140, marginTop: spacing.sm, gap: 6 },
  chartCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
  barTrack: { width: "100%", height: 100, backgroundColor: colors.surface, borderRadius: 4, overflow: "hidden", justifyContent: "flex-end", borderWidth: 1, borderColor: colors.border },
  barFill: { width: "100%", backgroundColor: colors.brandPrimary },
  barLabel: { color: colors.muted, fontSize: 10, marginTop: 4 },
  barValue: { color: colors.onSurface, fontSize: 9, marginBottom: 2, fontWeight: "500" },
});
