import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useCart } from "@/src/cart";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

export default function Checkout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const cart = useCart();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings() });
  const showPrice = settings.data?.show_prices_to_customers ?? true;

  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const clientRefRef = useRef<string>(`${user?.id || "u"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const submit = async () => {
    if (loading) return;
    if (cart.items.length === 0) { toast.show("Cart is empty", "error"); return; }
    setLoading(true);
    try {
      const items = cart.items.map(i => ({ product_id: i.product_id, variation: i.variation, quantity: i.quantity }));
      const order = await api.createOrder(items, notes, clientRefRef.current);
      cart.clear();
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.show(`Order ${order.order_number} submitted`, "success");
      router.replace(`/customer/order/${order.id}`);
    } catch (e: any) {
      toast.show(e.message || "Order submission failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="checkout-back" onPress={() => router.back()}><Text style={{ color: colors.brandPrimary }}>← Back to cart</Text></Pressable>
        <Text style={styles.title}>Review Order</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160 }}>
        <View style={styles.card}>
          <Text style={styles.section}>Delivery details</Text>
          <Field label="Name" value={user?.name || ""} />
          <Field label="Company" value={user?.company || "—"} />
          <Field label="Phone" value={user?.phone || "—"} />
          <Field label="Address" value={user?.address || "—"} />
          {!!user?.delivery_instructions && <Field label="Instructions" value={user.delivery_instructions} />}
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>Update in Account tab if needed.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Items ({cart.itemCount})</Text>
          {cart.items.map(i => (
            <View key={`${i.product_id}-${i.variation}`} style={styles.itemRow} testID={`review-item-${i.sku}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{i.product_name}{i.variation ? ` — ${i.variation}` : ""}</Text>
                <Text style={styles.itemMeta}>{i.sku} · {i.quantity} × {i.unit}</Text>
              </View>
              {showPrice && <Text style={styles.itemPrice}>RM {(i.unit_price * i.quantity).toFixed(2)}</Text>}
            </View>
          ))}
          {showPrice && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>RM {cart.total.toFixed(2)}</Text>
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Order notes (optional)</Text>
          <TextInput
            testID="order-notes-input"
            style={styles.notes}
            multiline
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. Please deliver after 3pm"
            placeholderTextColor={colors.muted}
          />
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="submit-order-button" title={loading ? "Submitting..." : "SUBMIT ORDER"} onPress={submit} loading={loading} />
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: colors.onSurface, fontSize: 14 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface, marginTop: 4 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  section: { fontWeight: "600", color: colors.onSurface, marginBottom: 6, fontSize: 15 },
  itemRow: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  itemName: { color: colors.onSurface, fontWeight: "500" },
  itemMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  itemPrice: { color: colors.brandPrimary, fontWeight: "600" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8 },
  totalLabel: { fontWeight: "600", color: colors.onSurface, fontSize: 16 },
  totalValue: { color: colors.brandPrimary, fontWeight: "700", fontSize: 18 },
  notes: { minHeight: 80, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, textAlignVertical: "top", backgroundColor: colors.surface },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.lg },
});
