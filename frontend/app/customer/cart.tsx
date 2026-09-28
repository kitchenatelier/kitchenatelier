import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { api, resolveImageUrl } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useCart } from "@/src/cart";

export default function Cart() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const cart = useCart();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings() });
  const showPrice = settings.data?.show_prices_to_customers ?? true;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Cart</Text>
        <Text style={styles.sub}>{cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}</Text>
      </View>

      {cart.items.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text testID="cart-empty" style={styles.empty}>Your cart is empty.</Text>
          <Button testID="cart-shop-btn" title="Browse products" onPress={() => router.push("/customer/products")} style={{ marginTop: spacing.md }} />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 200, gap: spacing.md }}>
            {cart.items.map(item => (
              <View key={`${item.product_id}-${item.variation}`} style={styles.row} testID={`cart-item-${item.sku}`}>
                <Image source={{ uri: resolveImageUrl(item.image_url) }} style={styles.img} contentFit="cover" />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.name}>{item.product_name}</Text>
                  {!!item.variation && <Text style={styles.meta}>Variation: {item.variation}</Text>}
                  <Text style={styles.meta}>{item.sku} · per {item.unit}</Text>
                  {showPrice && (
                    <Text style={styles.line}>
                      RM {item.unit_price.toFixed(2)} × {item.quantity} = RM {(item.unit_price * item.quantity).toFixed(2)}
                    </Text>
                  )}
                  <View style={styles.qtyRow}>
                    <Pressable
                      testID={`cart-minus-${item.sku}`}
                      style={styles.qBtn}
                      onPress={() => cart.updateQty(item.product_id, item.variation, item.quantity - 1)}
                    ><Text style={styles.qBtnText}>−</Text></Pressable>
                    <TextInput
                      style={styles.qInput}
                      value={String(item.quantity)}
                      keyboardType="number-pad"
                      textAlign="center"
                      onChangeText={t => {
                        const n = parseInt(t.replace(/[^0-9]/g, ""), 10);
                        if (n > 0) cart.updateQty(item.product_id, item.variation, n);
                      }}
                    />
                    <Pressable
                      testID={`cart-plus-${item.sku}`}
                      style={styles.qBtn}
                      onPress={() => cart.updateQty(item.product_id, item.variation, item.quantity + 1)}
                    ><Text style={styles.qBtnText}>+</Text></Pressable>
                    <Pressable
                      testID={`cart-remove-${item.sku}`}
                      style={styles.remove}
                      onPress={() => cart.remove(item.product_id, item.variation)}
                    ><Text style={{ color: colors.error, fontWeight: "600" }}>Remove</Text></Pressable>
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            {showPrice && (
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Estimated total</Text>
                <Text style={styles.totalValue}>RM {cart.total.toFixed(2)}</Text>
              </View>
            )}
            <Button
              testID="review-order-button"
              title="Review & Submit"
              onPress={() => router.push("/customer/checkout")}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface },
  sub: { color: colors.muted, marginTop: 2 },
  emptyBox: { alignItems: "center", padding: spacing.xxl },
  empty: { color: colors.muted, fontSize: 16 },
  row: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  img: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  name: { fontWeight: "600", color: colors.onSurface, fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  line: { color: colors.brandPrimary, fontWeight: "600", marginTop: 6 },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  qBtn: { width: 36, height: 36, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  qBtnText: { fontSize: 18, color: colors.onSurface },
  qInput: { width: 50, height: 36, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.onSurface },
  remove: { marginLeft: "auto", paddingHorizontal: 8, paddingVertical: 8 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.lg },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.md },
  totalLabel: { fontSize: 15, color: colors.onSurface },
  totalValue: { fontSize: 18, fontWeight: "700", color: colors.brandPrimary },
});
