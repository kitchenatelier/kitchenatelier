import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, FlatList, Pressable, ScrollView, TextInput, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

const STATUSES = ["All", "Order Received", "Under Review", "Confirmed", "Preparing", "Ready for Delivery", "Dispatched", "Delivered", "Completed", "Cancelled"];

export default function AdminOrders() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ status?: string }>();
  const [statusF, setStatusF] = useState(params.status || "All");
  const [q, setQ] = useState("");

  useEffect(() => { if (params.status) setStatusF(params.status); }, [params.status]);

  const orders = useQuery({
    queryKey: ["orders-admin", statusF, q],
    queryFn: () => api.listOrders(statusF === "All" ? "" : statusF, q),
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Orders</Text>
        <TextInput
          testID="admin-orders-search"
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="Search order # / customer"
          placeholderTextColor={colors.muted}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }} style={{ maxHeight: 56 }}>
          {STATUSES.map(s => (
            <Pressable
              key={s}
              testID={`filter-${s}`}
              onPress={() => setStatusF(s)}
              style={{
                flexShrink: 0, height: 36, paddingHorizontal: 14, borderRadius: 999,
                alignItems: "center", justifyContent: "center",
                backgroundColor: statusF === s ? colors.brandPrimary : colors.surfaceSecondary,
                borderWidth: 1, borderColor: statusF === s ? colors.brandPrimary : colors.border,
              }}
            >
              <Text style={{ color: statusF === s ? colors.onBrandPrimary : colors.onSurface, fontSize: 13 }}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={orders.data || []}
        keyExtractor={o => o.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={orders.isFetching} onRefresh={() => orders.refetch()} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={<Text style={styles.empty}>No orders</Text>}
        renderItem={({ item }) => (
          <Pressable testID={`admin-order-${item.order_number}`} style={styles.card} onPress={() => router.push(`/admin/order/${item.id}`)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.num}>{item.order_number}</Text>
              <Text style={styles.status}>{item.status}</Text>
            </View>
            <Text style={styles.meta}>{item.customer_company || item.customer_name}</Text>
            <Text style={styles.meta}>{new Date(item.created_at).toLocaleString()} · {item.items.length} items</Text>
            <Text style={styles.total}>RM {item.total_amount.toFixed(2)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, paddingBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  search: { marginHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44, color: colors.onSurface, fontSize: 15 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  num: { fontWeight: "600", color: colors.onSurface },
  status: { color: colors.brandPrimary, fontWeight: "500" },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  total: { color: colors.brandPrimary, fontWeight: "600", marginTop: 4 },
  empty: { color: colors.muted, textAlign: "center", marginTop: spacing.xxl },
});
