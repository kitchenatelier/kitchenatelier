import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, resolveImageUrl } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useCart } from "@/src/cart";
import { useToast } from "@/src/toast";

export default function ProductDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cart = useCart();
  const toast = useToast();

  const product = useQuery({ queryKey: ["product", id], queryFn: () => api.getProduct(id!) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings() });

  const [variation, setVariation] = useState<string>("");
  const [qty, setQty] = useState<string>("1");

  const p = product.data;
  const showPrice = settings.data?.show_prices_to_customers ?? true;

  const selectedVar = useMemo(() => p?.variations.find(v => v.name === variation), [p, variation]);
  const unitPrice = selectedVar?.price ?? p?.price ?? 0;

  const onAdd = () => {
    if (!p) return;
    const n = parseInt(qty, 10);
    if (!n || n <= 0) { toast.show("Enter a valid quantity", "error"); return; }
    if (p.variations.length > 0 && !variation) { toast.show("Please choose a variation", "error"); return; }
    cart.add({
      product_id: p.id, product_name: p.name, sku: p.sku,
      variation: variation, quantity: n, unit: p.unit, unit_price: unitPrice, image_url: p.image_url,
    });
    toast.show(`Added ${n} × ${p.name}${variation ? " (" + variation + ")" : ""}`, "success");
    router.back();
  };

  if (!p) return <View style={{ flex: 1, backgroundColor: colors.surface }} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={{ paddingTop: insets.top + spacing.sm, paddingHorizontal: spacing.lg }}>
          <Pressable testID="pd-back" onPress={() => router.back()}>
            <Text style={{ color: colors.brandPrimary }}>← Back</Text>
          </Pressable>
        </View>
        <Image source={{ uri: resolveImageUrl(p.image_url) }} style={styles.image} contentFit="cover" />

        <View style={{ padding: spacing.lg }}>
          <Text style={styles.name}>{p.name}</Text>
          <Text style={styles.sku}>{p.sku} · {p.category} · per {p.unit}</Text>
          {showPrice && <Text style={styles.price}>RM {unitPrice.toFixed(2)}</Text>}
          {!showPrice && <Text style={styles.priceHidden}>Price confirmed after order review</Text>}
          <Text style={styles.desc}>{p.description}</Text>

          {p.variations.length > 0 && (
            <View style={{ marginTop: spacing.lg }}>
              <Text style={styles.sectionLabel}>Choose variation</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
                {p.variations.map(v => (
                  <Pressable
                    key={v.name}
                    testID={`variation-${v.name}`}
                    onPress={() => setVariation(v.name)}
                    style={[styles.varChip, variation === v.name && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}
                  >
                    <Text style={{ color: variation === v.name ? colors.onBrandPrimary : colors.onSurface, fontWeight: "500" }}>{v.name}</Text>
                    {showPrice && <Text style={{ color: variation === v.name ? colors.onBrandPrimary : colors.muted, fontSize: 11 }}>RM {v.price.toFixed(2)}</Text>}
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <View style={{ marginTop: spacing.lg }}>
            <Text style={styles.sectionLabel}>Quantity</Text>
            <View style={styles.qtyRow}>
              <Pressable testID="qty-minus" style={styles.qtyBtn} onPress={() => setQty(String(Math.max(1, parseInt(qty || "1", 10) - 1)))}>
                <Text style={styles.qtyBtnText}>−</Text>
              </Pressable>
              <TextInput
                testID="qty-input"
                style={styles.qtyInput}
                value={qty}
                onChangeText={t => setQty(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                textAlign="center"
              />
              <Pressable testID="qty-plus" style={styles.qtyBtn} onPress={() => setQty(String(parseInt(qty || "0", 10) + 1))}>
                <Text style={styles.qtyBtnText}>+</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="add-to-order-button" title="Add to Order" onPress={onAdd} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: "100%", height: 260, backgroundColor: colors.surfaceTertiary, marginTop: spacing.md },
  name: { fontSize: 22, fontWeight: "600", color: colors.onSurface },
  sku: { color: colors.muted, marginTop: 4 },
  price: { fontSize: 20, color: colors.brandPrimary, fontWeight: "600", marginTop: 8 },
  priceHidden: { color: colors.muted, marginTop: 8, fontStyle: "italic" },
  desc: { color: colors.onSurface, marginTop: spacing.md, lineHeight: 20 },
  sectionLabel: { fontWeight: "600", color: colors.onSurface },
  varChip: {
    minWidth: 60, paddingHorizontal: spacing.md, paddingVertical: 10,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary, alignItems: "center",
  },
  qtyRow: { flexDirection: "row", marginTop: spacing.sm, gap: spacing.sm, alignItems: "center" },
  qtyBtn: {
    width: 48, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary, alignItems: "center", justifyContent: "center",
  },
  qtyBtnText: { fontSize: 22, color: colors.onSurface },
  qtyInput: {
    width: 80, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary, fontSize: 18, color: colors.onSurface,
  },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
    padding: spacing.lg,
  },
});
