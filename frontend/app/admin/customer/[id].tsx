import { useEffect, useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, CustomerPrice } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

type PriceRow = { key: string; product_id: string; product_name: string; variation: string; base_price: number; override?: string };

export default function AdminCustomerDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const customer = useQuery({ queryKey: ["customer", id], queryFn: () => api.getCustomer(id!) });
  const prices = useQuery({ queryKey: ["customer-prices", id], queryFn: () => api.getCustomerPrices(id!) });
  const products = useQuery({ queryKey: ["products-admin"], queryFn: () => api.listProducts() });
  const orders = useQuery({ queryKey: ["orders-admin-cust", id], queryFn: () => api.listOrders() });

  const [profile, setProfile] = useState({
    name: "", company: "", phone: "", address: "", delivery_instructions: "", payment_terms_days: "30",
  });
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPrices, setSavingPrices] = useState(false);

  useEffect(() => {
    if (customer.data) {
      setProfile({
        name: customer.data.name || "",
        company: customer.data.company || "",
        phone: customer.data.phone || "",
        address: customer.data.address || "",
        delivery_instructions: customer.data.delivery_instructions || "",
        payment_terms_days: String(customer.data.payment_terms_days ?? 30),
      });
    }
  }, [customer.data]);

  useEffect(() => {
    if (products.data && prices.data) {
      const priceMap = new Map<string, number>();
      prices.data.forEach(p => priceMap.set(`${p.product_id}|${p.variation}`, p.price));
      const newRows: PriceRow[] = [];
      for (const p of products.data) {
        if (p.variations.length > 0) {
          for (const v of p.variations) {
            const key = `${p.id}|${v.name}`;
            newRows.push({
              key, product_id: p.id, product_name: p.name, variation: v.name, base_price: v.price,
              override: priceMap.has(key) ? String(priceMap.get(key)) : "",
            });
          }
        } else {
          const key = `${p.id}|`;
          newRows.push({
            key, product_id: p.id, product_name: p.name, variation: "", base_price: p.price,
            override: priceMap.has(key) ? String(priceMap.get(key)) : "",
          });
        }
      }
      setRows(newRows);
    }
  }, [products.data, prices.data]);

  const custOrders = useMemo(
    () => (orders.data || []).filter(o => o.customer_id === id),
    [orders.data, id],
  );

  const set = (k: keyof typeof profile) => (v: string) => setProfile(p => ({ ...p, [k]: v }));

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await api.updateCustomer(id!, {
        name: profile.name, company: profile.company, phone: profile.phone,
        address: profile.address, delivery_instructions: profile.delivery_instructions,
        payment_terms_days: parseInt(profile.payment_terms_days || "30", 10) || 30,
      });
      qc.invalidateQueries({ queryKey: ["customer", id] });
      qc.invalidateQueries({ queryKey: ["customers-admin"] });
      toast.show("Customer updated", "success");
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setSavingProfile(false); }
  };

  const savePrices = async () => {
    setSavingPrices(true);
    const payload: CustomerPrice[] = rows
      .filter(r => r.override && r.override.trim() !== "")
      .map(r => ({
        product_id: r.product_id,
        variation: r.variation,
        price: parseFloat(r.override || "0") || 0,
      }))
      .filter(p => p.price >= 0);
    try {
      const result = await api.updateCustomerPrices(id!, payload);
      qc.invalidateQueries({ queryKey: ["customer-prices", id] });
      toast.show(`Saved ${result.count} custom prices`, "success");
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setSavingPrices(false); }
  };

  if (!customer.data) return <View style={{ flex: 1, backgroundColor: colors.surface }} />;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="cust-detail-back" onPress={() => router.back()}>
          <Text style={{ color: colors.brandPrimary }}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>{customer.data.name || customer.data.email}</Text>
        <Text style={styles.meta}>{customer.data.email}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.section}>Profile</Text>
          <Field label="Name" testID="cd-name" value={profile.name} onChangeText={set("name")} />
          <Field label="Company" testID="cd-company" value={profile.company} onChangeText={set("company")} />
          <Field label="Phone" testID="cd-phone" value={profile.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
          <Field label="Delivery address" testID="cd-address" value={profile.address} onChangeText={set("address")} multiline />
          <Field label="Delivery instructions" testID="cd-instructions" value={profile.delivery_instructions} onChangeText={set("delivery_instructions")} multiline />
          <Field label="Payment terms (days)" testID="cd-terms" value={profile.payment_terms_days} onChangeText={set("payment_terms_days")} keyboardType="number-pad" />
          <Text style={styles.hint}>When an order is Confirmed, invoice date is set to today and payment is due after this many days.</Text>
          <Button testID="cd-save-profile" title="Save profile" onPress={saveProfile} loading={savingProfile} style={{ marginTop: spacing.sm }} />
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Custom prices (visible only to this customer)</Text>
          <Text style={styles.hint}>Leave blank to use the base price. Applies at order time.</Text>
          {rows.map((r, idx) => (
            <View key={r.key} style={styles.priceRow} testID={`price-row-${idx}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.priceName}>{r.product_name}{r.variation ? ` — ${r.variation}` : ""}</Text>
                <Text style={styles.priceBase}>Base RM {r.base_price.toFixed(2)}</Text>
              </View>
              <TextInput
                testID={`price-input-${idx}`}
                style={styles.priceInput}
                placeholder={r.base_price.toFixed(2)}
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                value={r.override}
                onChangeText={t => setRows(prev => prev.map(x => x.key === r.key ? { ...x, override: t.replace(/[^0-9.]/g, "") } : x))}
              />
            </View>
          ))}
          <Button testID="cd-save-prices" title="Save custom prices" onPress={savePrices} loading={savingPrices} variant="secondary" style={{ marginTop: spacing.sm }} />
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Recent orders ({custOrders.length})</Text>
          {custOrders.length === 0 ? (
            <Text style={styles.hint}>No orders yet</Text>
          ) : custOrders.slice(0, 20).map(o => (
            <Pressable
              key={o.id}
              onPress={() => router.push(`/admin/order/${o.id}`)}
              style={styles.orderRow}
              testID={`cust-order-${o.order_number}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "600", color: colors.onSurface }}>{o.order_number}</Text>
                <Text style={styles.hint}>{new Date(o.created_at).toLocaleDateString()} · {o.status}</Text>
              </View>
              <Text style={{ color: colors.brandPrimary, fontWeight: "600" }}>RM {o.total_amount.toFixed(2)}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field(props: any) {
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.muted}
        style={[styles.input, props.multiline && { minHeight: 70, textAlignVertical: "top" }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface, marginTop: 6 },
  meta: { color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  section: { fontWeight: "600", color: colors.onSurface, fontSize: 15, marginBottom: 4 },
  label: { color: colors.onSurface, fontWeight: "500", marginBottom: 4, fontSize: 13 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.onSurface, minHeight: 42, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12, marginTop: 4 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  priceName: { color: colors.onSurface, fontSize: 14, fontWeight: "500" },
  priceBase: { color: colors.muted, fontSize: 11, marginTop: 2 },
  priceInput: { width: 90, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 8, backgroundColor: colors.surface, textAlign: "right", color: colors.onSurface },
  orderRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
});
