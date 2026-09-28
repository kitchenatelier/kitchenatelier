import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Linking, Platform } from "react-native";
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

export default function AdminDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();

  const summary = useQuery({ queryKey: ["dashboard"], queryFn: () => api.dashboardSummary() });
  const recent = useQuery({ queryKey: ["orders-admin", ""], queryFn: () => api.listOrders() });
  const [months, setMonths] = useState(1);
  const insights = useQuery({
    queryKey: ["top-customers", months],
    queryFn: () => api.topCustomers(months),
  });

  const [exporting, setExporting] = useState(false);

  const counts = summary.data?.counts || {};
  const topList = insights.data?.customers || [];

  const exportTodayCsv = async () => {
    setExporting(true);
    try {
      const token = await tokenStore.get();
      const url = api.ordersCsvUrl(); // defaults to today
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (Platform.OS === "web") {
        const objectUrl = URL.createObjectURL(blob);
        const a = (window as any).document.createElement("a");
        a.href = objectUrl;
        a.download = `orders-today.csv`;
        (window as any).document.body.appendChild(a);
        a.click();
        a.remove();
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
            refreshing={summary.isFetching || recent.isFetching || insights.isFetching}
            onRefresh={() => { summary.refetch(); recent.refetch(); insights.refetch(); }}
            tintColor={colors.brandPrimary}
          />
        }
      >
        <Button
          testID="export-today-csv"
          title={exporting ? "Preparing CSV..." : "Export today's orders (CSV)"}
          onPress={exportTodayCsv}
          loading={exporting}
          variant="secondary"
          style={{ marginBottom: spacing.md }}
        />

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

        <View style={styles.insightsCard}>
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
            style={styles.card}
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
  section: { fontSize: 16, fontWeight: "600", color: colors.onSurface, marginTop: spacing.md, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  num: { fontWeight: "600", color: colors.onSurface },
  status: { color: colors.brandPrimary, fontWeight: "500" },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  total: { color: colors.brandPrimary, fontWeight: "600", marginTop: 4 },
  insightsCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  insightRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: 8 },
  rank: { width: 24, height: 24, borderRadius: 999, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  rankText: { color: colors.onBrandTertiary, fontWeight: "700", fontSize: 12 },
  custName: { fontWeight: "600", color: colors.onSurface },
  custMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  custAmount: { color: colors.brandPrimary, fontWeight: "700" },
  empty: { color: colors.muted, fontStyle: "italic", paddingVertical: spacing.sm },
});
