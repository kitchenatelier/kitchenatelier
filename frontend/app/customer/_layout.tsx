import { Tabs, Redirect } from "expo-router";
import { useAuth } from "@/src/auth";
import { colors } from "@/src/theme";
import { useCart } from "@/src/cart";
import { View, Text, StyleSheet } from "react-native";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return <Text style={{ fontSize: 11, color: focused ? colors.brandPrimary : colors.muted, fontWeight: focused ? "600" : "400" }}>{label}</Text>;
}

function CartBadge({ focused }: { focused: boolean }) {
  const { itemCount } = useCart();
  return (
    <View>
      <Text style={{ fontSize: 11, color: focused ? colors.brandPrimary : colors.muted, fontWeight: focused ? "600" : "400" }}>Cart</Text>
      {itemCount > 0 && (
        <View style={styles.badge}><Text style={styles.badgeText}>{itemCount}</Text></View>
      )}
    </View>
  );
}

export default function CustomerLayout() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "customer") return <Redirect href="/admin/dashboard" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surfaceSecondary, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.brandPrimary,
        tabBarInactiveTintColor: colors.muted,
        tabBarShowLabel: false,
        tabBarItemStyle: { alignSelf: "center" },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Home", tabBarIcon: ({ focused }) => <TabIcon label="Home" focused={focused} /> }} />
      <Tabs.Screen name="products" options={{ title: "Products", tabBarIcon: ({ focused }) => <TabIcon label="Products" focused={focused} /> }} />
      <Tabs.Screen name="cart" options={{ title: "Cart", tabBarIcon: ({ focused }) => <CartBadge focused={focused} /> }} />
      <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: ({ focused }) => <TabIcon label="Orders" focused={focused} /> }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: ({ focused }) => <TabIcon label="Account" focused={focused} /> }} />
      <Tabs.Screen name="product/[id]" options={{ href: null }} />
      <Tabs.Screen name="order/[id]" options={{ href: null }} />
      <Tabs.Screen name="checkout" options={{ href: null }} />
      <Tabs.Screen name="edo/[id]" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: "absolute", top: -8, right: -14, backgroundColor: colors.brandPrimary,
    borderRadius: 999, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: "center", justifyContent: "center",
  },
  badgeText: { color: colors.onBrandPrimary, fontSize: 10, fontWeight: "600" },
});
