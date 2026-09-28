import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { colors, radius, spacing } from "@/src/theme";

export default function CustomerHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const orders = useQuery({ queryKey: ["orders"], queryFn: () => api.listOrders() });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => api.listNotifications() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings() });

  const activeOrders = (orders.data || []).filter(o => !["Completed", "Cancelled", "Delivered"].includes(o.status));
  const unread = (notifications.data || []).filter(n => !n.read);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.brand}>The Kitchen Atelier</Text>
        <Text style={styles.greeting}>Hi {user?.name || "there"} 👋</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={orders.isFetching} onRefresh={() => { orders.refetch(); notifications.refetch(); }} tintColor={colors.brandPrimary} />}
      >
        <Pressable testID="home-browse-products" style={styles.cta} onPress={() => router.push("/customer/products")}>
          <Text style={styles.ctaTitle}>Browse Catalogue</Text>
          <Text style={styles.ctaSub}>Find products, pick variations and quantities</Text>
        </Pressable>

        <SectionTitle title="Active Orders" />
        {activeOrders.length === 0 ? (
          <EmptyLine text="No active orders" testID="home-no-active-orders" />
        ) : (
          activeOrders.slice(0, 5).map(o => (
            <Pressable
              key={o.id}
              testID={`home-order-${o.order_number}`}
              style={styles.card}
              onPress={() => router.push(`/customer/order/${o.id}`)}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={styles.cardTitle}>{o.order_number}</Text>
                <StatusChip status={o.status} />
              </View>
              <Text style={styles.cardMeta}>{o.items.length} items · {new Date(o.created_at).toLocaleDateString()}</Text>
              {settings.data?.show_prices_to_customers && (
                <Text style={styles.cardTotal}>RM {o.total_amount.toFixed(2)}</Text>
              )}
            </Pressable>
          ))
        )}

        <SectionTitle title="Recent Notifications" />
        {(notifications.data || []).length === 0 ? (
          <EmptyLine text="No notifications yet" testID="home-no-notifications" />
        ) : (
          notifications.data!.slice(0, 5).map(n => (
            <View key={n.id} style={styles.card} testID={`notification-${n.id}`}>
              <Text style={styles.notifTitle}>{n.order_number}{unread.some(u => u.id === n.id) ? " • NEW" : ""}</Text>
              <Text style={styles.notifMsg}>{n.message}</Text>
              <Text style={styles.notifTime}>{new Date(n.created_at).toLocaleString()}</Text>
            </View>
          ))
        )}

        {settings.data && (
          <View style={[styles.card, { marginTop: spacing.lg }]}>
            <Text style={styles.cardTitle}>Contact us</Text>
            <Text style={styles.notifMsg}>{settings.data.company_contact}</Text>
            <Text style={styles.notifMsg}>{settings.data.company_phone}</Text>
            <Text style={styles.notifMsg}>{settings.data.company_email}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}
function EmptyLine({ text, testID }: { text: string; testID: string }) {
  return <Text testID={testID} style={styles.empty}>{text}</Text>;
}

export function StatusChip({ status }: { status: string }) {
  const bg =
    status === "Order Received" ? colors.brandTertiary :
    status === "Cancelled" ? "#F5D8D8" :
    status === "Completed" || status === "Delivered" ? "#DCEAE0" :
    status === "Dispatched" || status === "Ready for Delivery" ? "#FDE8CE" :
    colors.surfaceTertiary;
  const fg =
    status === "Order Received" ? colors.onBrandTertiary :
    status === "Cancelled" ? colors.error :
    status === "Completed" || status === "Delivered" ? colors.success :
    status === "Dispatched" || status === "Ready for Delivery" ? colors.warning :
    colors.onSurface;
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" }}>
      <Text style={{ color: fg, fontSize: 11, fontWeight: "600" }}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.surface },
  brand: { fontSize: 20, fontWeight: "600", color: colors.onSurface },
  greeting: { color: colors.muted, marginTop: 2 },
  cta: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.lg, padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  ctaTitle: { color: colors.onBrandPrimary, fontSize: 18, fontWeight: "600" },
  ctaSub: { color: colors.onBrandPrimary, opacity: 0.9, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: colors.onSurface, marginTop: spacing.md, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  cardTitle: { fontWeight: "600", color: colors.onSurface, fontSize: 16 },
  cardMeta: { color: colors.muted, marginTop: 4, fontSize: 12 },
  cardTotal: { color: colors.brandPrimary, fontWeight: "600", marginTop: 4 },
  notifTitle: { fontWeight: "600", color: colors.onSurface, fontSize: 13 },
  notifMsg: { color: colors.onSurface, marginTop: 4, fontSize: 14 },
  notifTime: { color: colors.muted, marginTop: 4, fontSize: 11 },
  empty: { color: colors.muted, fontStyle: "italic", marginVertical: spacing.sm },
});
