import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { StatusChip } from "./home";

export default function Orders() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api.listOrders() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings() });
  const showPrice = settings.data?.show_prices_to_customers ?? true;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>My Orders</Text>
      </View>
      <FlatList
        data={orders.data || []}
        keyExtractor={o => o.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={orders.isFetching} onRefresh={() => orders.refetch()} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={<Text testID="orders-empty" style={styles.empty}>No orders yet</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.card} testID={`orders-list-${item.order_number}`} onPress={() => router.push(`/customer/order/${item.id}`)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.num}>{item.order_number}</Text>
              <StatusChip status={item.status} />
            </View>
            <Text style={styles.meta}>{new Date(item.created_at).toLocaleString()}</Text>
            <Text style={styles.meta}>{item.items.length} product{item.items.length === 1 ? "" : "s"} · {item.items.reduce((s, i) => s + i.quantity, 0)} units</Text>
            {showPrice && <Text style={styles.total}>RM {item.total_amount.toFixed(2)}</Text>}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface },
  empty: { color: colors.muted, textAlign: "center", marginTop: spacing.xxl },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  num: { fontWeight: "600", color: colors.onSurface, fontSize: 16 },
  meta: { color: colors.muted, marginTop: 4, fontSize: 12 },
  total: { color: colors.brandPrimary, fontWeight: "600", marginTop: 6 },
});
