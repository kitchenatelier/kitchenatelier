import { useQuery, useQueryClient } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, Platform } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, resolveImageUrl, tokenStore } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { StatusChip } from "../home";
import { useCart } from "@/src/cart";
import { useToast } from "@/src/toast";

const EDO_ELIGIBLE = new Set(["Ready for Delivery", "Dispatched", "Delivered", "Completed"]);

export default function CustomerOrderDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const cart = useCart();

  const order = useQuery({ queryKey: ["order", id], queryFn: () => api.getOrder(id!) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings() });
  const showPrice = settings.data?.show_prices_to_customers ?? true;

  const o = order.data;

  const reorder = async () => {
    if (!o) return;
    for (const it of o.items) {
      try {
        const p = await api.getProduct(it.product_id);
        cart.add({
          product_id: p.id, product_name: p.name, sku: p.sku,
          variation: it.variation, quantity: it.quantity, unit: p.unit,
          unit_price: it.unit_price, image_url: p.image_url,
        });
      } catch {}
    }
    toast.show("Items added to cart", "success");
    router.push("/customer/cart");
  };

  const openInvoice = async () => {
    if (!o) return;
    const token = await tokenStore.get();
    try {
      const res = await fetch(api.invoiceUrl(o.id), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { toast.show("Could not open invoice", "error"); return; }
      const blob = await res.blob();
      if (Platform.OS === "web") {
        (window as any).open(URL.createObjectURL(blob), "_blank");
      } else {
        const reader = new FileReader();
        reader.onloadend = () => Linking.openURL(reader.result as string).catch(() => toast.show("Open on web preview to download", "info"));
        reader.readAsDataURL(blob);
      }
    } catch { toast.show("Could not open invoice", "error"); }
  };

  if (!o) return <View style={{ flex: 1, backgroundColor: colors.surface }} />;

  const canSignEdo = !o.edo?.signed && EDO_ELIGIBLE.has(o.status);
  const dueOverdue = o.invoice_due_at && !o.paid && new Date(o.invoice_due_at) < new Date();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="cust-order-back" onPress={() => router.back()}><Text style={{ color: colors.brandPrimary }}>← Back</Text></Pressable>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <Text style={styles.title}>{o.order_number}</Text>
          <StatusChip status={o.status} />
        </View>
        <Text style={styles.meta}>Placed {new Date(o.created_at).toLocaleString()}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 120 }}>
        {!!o.customer_facing_notes && (
          <View style={[styles.card, { backgroundColor: colors.brandTertiary }]}>
            <Text style={{ color: colors.onBrandTertiary, fontWeight: "600", marginBottom: 4 }}>Message from The Kitchen Atelier</Text>
            <Text style={{ color: colors.onBrandTertiary }}>{o.customer_facing_notes}</Text>
          </View>
        )}

        {canSignEdo && (
          <View style={[styles.card, { borderColor: colors.brandPrimary, borderWidth: 1.5 }]} testID="edo-cta-card">
            <Text style={styles.section}>Sign the E-DO on receipt</Text>
            <Text style={styles.hint}>Once the goods arrive, please sign the Electronic Delivery Order and upload a photo of the box. This confirms receipt.</Text>
            <Button
              testID="sign-edo-button"
              title="Sign E-DO"
              onPress={() => router.push(`/customer/edo/${o.id}`)}
              style={{ marginTop: spacing.sm }}
            />
          </View>
        )}

        {o.edo?.signed && (
          <View style={styles.card} testID="edo-signed-card">
            <Text style={styles.section}>E-DO signed ✓</Text>
            <Text style={styles.hint}>
              Signed by {o.edo.signer_name} on {o.edo.signed_at ? new Date(o.edo.signed_at).toLocaleString() : "-"}
            </Text>
            {!!o.edo.signature_url && (
              <Image source={{ uri: resolveImageUrl(o.edo.signature_url) }} style={styles.sig} contentFit="contain" />
            )}
            <ScrollView horizontal contentContainerStyle={{ gap: 8, marginTop: 8 }} showsHorizontalScrollIndicator={false}>
              {o.edo.photo_urls.map(u => (
                <Image key={u} source={{ uri: resolveImageUrl(u) }} style={styles.thumb} contentFit="cover" />
              ))}
            </ScrollView>
          </View>
        )}

        {(o.invoice_issued_at || o.invoice_due_at) && showPrice && (
          <View style={styles.card}>
            <Text style={styles.section}>Invoice</Text>
            {o.invoice_issued_at && <Text style={styles.line}>Issued: {new Date(o.invoice_issued_at).toLocaleDateString()}</Text>}
            {o.invoice_due_at && (
              <Text style={[styles.line, dueOverdue && { color: colors.error, fontWeight: "600" }]}>
                Due: {new Date(o.invoice_due_at).toLocaleDateString()} ({o.payment_terms_days} days){dueOverdue ? " · OVERDUE" : ""}
              </Text>
            )}
            <Text style={styles.line}>Payment: {o.paid ? "Paid ✓" : "Unpaid"}</Text>
            <Button testID="cust-invoice-btn" title="Open invoice PDF" onPress={openInvoice} variant="secondary" style={{ marginTop: 8 }} />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.section}>Items</Text>
          {o.items.map((it, idx) => (
            <View key={idx} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{it.product_name}{it.variation ? ` — ${it.variation}` : ""}</Text>
                <Text style={styles.itemMeta}>{it.sku} · {it.quantity} × {it.unit}</Text>
              </View>
              {showPrice && <Text style={styles.itemPrice}>RM {it.line_total.toFixed(2)}</Text>}
            </View>
          ))}
          {showPrice && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>RM {o.total_amount.toFixed(2)}</Text>
            </View>
          )}
        </View>

        {!!o.notes && (
          <View style={styles.card}>
            <Text style={styles.section}>My notes</Text>
            <Text>{o.notes}</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.section}>Status history</Text>
          {o.status_history.map((h: any, idx: number) => (
            <View key={idx} style={{ paddingVertical: 6 }}>
              <Text style={{ color: colors.onSurface, fontWeight: "500" }}>
                {h.from ? `${h.from} → ` : ""}{h.to}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>{new Date(h.at).toLocaleString()}</Text>
              {!!h.note && <Text style={{ color: colors.onSurface, fontSize: 13, marginTop: 2 }}>{h.note}</Text>}
            </View>
          ))}
        </View>

        <Button testID="reorder-button" title="Reorder" onPress={reorder} variant="secondary" />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: 20, fontWeight: "600", color: colors.onSurface },
  meta: { color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  section: { fontWeight: "600", color: colors.onSurface, marginBottom: 6, fontSize: 15 },
  hint: { color: colors.muted, fontSize: 13, marginTop: 4 },
  line: { color: colors.onSurface, fontSize: 13, marginTop: 2 },
  itemRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  itemName: { color: colors.onSurface, fontWeight: "500" },
  itemMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  itemPrice: { color: colors.brandPrimary, fontWeight: "600" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8 },
  totalLabel: { fontWeight: "600", color: colors.onSurface, fontSize: 16 },
  totalValue: { color: colors.brandPrimary, fontWeight: "700", fontSize: 18 },
  sig: { width: "100%", height: 100, marginTop: 8, backgroundColor: colors.surface, borderRadius: radius.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
});
