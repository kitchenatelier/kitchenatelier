import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

const STATUSES = ["Order Received", "Under Review", "Confirmed", "Preparing", "Ready for Delivery", "Dispatched", "Delivered", "Completed", "Cancelled"];

export default function AdminOrderDetail() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();

  const order = useQuery({ queryKey: ["order-admin", id], queryFn: () => api.getOrder(id!) });

  const [adminNotes, setAdminNotes] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (order.data) {
      setAdminNotes(order.data.admin_notes || "");
      setCustomerNote(order.data.customer_facing_notes || "");
    }
  }, [order.data]);

  const o = order.data;
  if (!o) return <View style={{ flex: 1, backgroundColor: colors.surface }} />;

  const changeStatus = async (status: string) => {
    if (status === o.status) return;
    setSaving(true);
    try {
      await api.updateOrderStatus(o.id, status, statusNote);
      setStatusNote("");
      qc.invalidateQueries({ queryKey: ["order-admin", id] });
      qc.invalidateQueries({ queryKey: ["orders-admin"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.show(`Status → ${status}`, "success");
    } catch (e: any) {
      toast.show(e.message || "Failed to update status", "error");
    } finally { setSaving(false); }
  };

  const saveNotes = async () => {
    setSaving(true);
    try {
      await api.updateOrderNotes(o.id, adminNotes, customerNote);
      qc.invalidateQueries({ queryKey: ["order-admin", id] });
      toast.show("Notes saved", "success");
    } catch (e: any) {
      toast.show(e.message || "Failed to save notes", "error");
    } finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="admin-order-back" onPress={() => router.back()}><Text style={{ color: colors.brandPrimary }}>← Back</Text></Pressable>
        <Text style={styles.title}>{o.order_number}</Text>
        <Text style={styles.meta}>Current: {o.status}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 100, gap: spacing.md }}>
        <View style={styles.card}>
          <Text style={styles.section}>Customer</Text>
          <Text>{o.customer_name}</Text>
          <Text style={styles.meta}>{o.customer_company}</Text>
          <Text style={styles.meta}>{o.customer_phone}</Text>
          <Text style={styles.meta}>{o.customer_address}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Items</Text>
          {o.items.map((it, idx) => (
            <View key={idx} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "500", color: colors.onSurface }}>{it.product_name}{it.variation ? ` — ${it.variation}` : ""}</Text>
                <Text style={styles.meta}>{it.sku} · {it.quantity} × {it.unit}</Text>
              </View>
              <Text style={{ color: colors.brandPrimary, fontWeight: "600" }}>RM {it.line_total.toFixed(2)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={{ fontWeight: "600" }}>Total</Text>
            <Text style={{ color: colors.brandPrimary, fontWeight: "700", fontSize: 18 }}>RM {o.total_amount.toFixed(2)}</Text>
          </View>
        </View>

        {!!o.notes && (
          <View style={styles.card}>
            <Text style={styles.section}>Customer notes</Text>
            <Text>{o.notes}</Text>
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.section}>Update status</Text>
          <TextInput
            testID="status-note-input"
            style={styles.notes}
            multiline
            value={statusNote}
            onChangeText={setStatusNote}
            placeholder="Optional customer-facing note"
            placeholderTextColor={colors.muted}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {STATUSES.map(s => (
              <Pressable
                key={s}
                testID={`set-status-${s}`}
                onPress={() => changeStatus(s)}
                disabled={saving || s === o.status}
                style={{
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                  backgroundColor: s === o.status ? colors.brandPrimary : colors.surface,
                  borderWidth: 1, borderColor: s === o.status ? colors.brandPrimary : colors.border,
                  opacity: saving && s !== o.status ? 0.5 : 1,
                }}
              >
                <Text style={{ color: s === o.status ? colors.onBrandPrimary : colors.onSurface, fontSize: 12 }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Notes</Text>
          <Text style={{ color: colors.muted, marginBottom: 4 }}>Internal (private)</Text>
          <TextInput testID="admin-internal-notes" style={styles.notes} multiline value={adminNotes} onChangeText={setAdminNotes} placeholderTextColor={colors.muted} />
          <Text style={{ color: colors.muted, marginTop: 8, marginBottom: 4 }}>Customer-facing</Text>
          <TextInput testID="admin-cust-notes" style={styles.notes} multiline value={customerNote} onChangeText={setCustomerNote} placeholderTextColor={colors.muted} />
          <Button testID="save-notes" title="Save notes" onPress={saveNotes} loading={saving} style={{ marginTop: spacing.sm }} variant="secondary" />
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Status history</Text>
          {o.status_history.map((h: any, idx: number) => (
            <View key={idx} style={{ paddingVertical: 4 }}>
              <Text>{h.from ? `${h.from} → ` : ""}{h.to}</Text>
              <Text style={styles.meta}>{new Date(h.at).toLocaleString()} · {h.by_email}</Text>
              {!!h.note && <Text style={{ fontSize: 12 }}>{h.note}</Text>}
            </View>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface, marginTop: 4 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  section: { fontWeight: "600", color: colors.onSurface, marginBottom: 6, fontSize: 15 },
  itemRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8 },
  notes: { minHeight: 60, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, textAlignVertical: "top", backgroundColor: colors.surface },
});
