import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

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
  const summary = useQuery({ queryKey: ["dashboard"], queryFn: () => api.dashboardSummary() });
  const recent = useQuery({ queryKey: ["orders-admin", ""], queryFn: () => api.listOrders() });

  const counts = summary.data?.counts || {};

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Admin Dashboard</Text>
        <Text style={styles.sub}>Total orders: {summary.data?.total ?? 0}</Text>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={summary.isFetching || recent.isFetching} onRefresh={() => { summary.refetch(); recent.refetch(); }} tintColor={colors.brandPrimary} />}
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
});
