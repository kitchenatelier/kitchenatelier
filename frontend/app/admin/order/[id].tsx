import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  KeyboardAvoidingView, Platform, Linking, Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { api, resolveImageUrl, tokenStore } from "@/src/api";
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
  const [busy, setBusy] = useState(false);

  // Edit items state
  const [editingItems, setEditingItems] = useState(false);
  const [draftQty, setDraftQty] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (order.data) {
      setAdminNotes(order.data.admin_notes || "");
      setCustomerNote(order.data.customer_facing_notes || "");
    }
  }, [order.data]);

  const o = order.data;
  if (!o) return <View style={{ flex: 1, backgroundColor: colors.surface }} />;

  const canEdit = o.status !== "Cancelled" && !o.edo?.signed;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["order-admin", id] });
    qc.invalidateQueries({ queryKey: ["orders-admin"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["products-admin"] });
  };

  const changeStatus = async (status: string) => {
    if (status === o.status || busy) return;
    setBusy(true);
    try {
      await api.updateOrderStatus(o.id, status, statusNote);
      setStatusNote("");
      invalidate();
      toast.show(`Status → ${status}`, "success");
    } catch (e: any) { toast.show(e.message || "Failed to update status", "error"); }
    finally { setBusy(false); }
  };

  const saveNotes = async () => {
    setBusy(true);
    try {
      await api.updateOrderNotes(o.id, adminNotes, customerNote);
      invalidate();
      toast.show("Notes saved", "success");
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setBusy(false); }
  };

  const togglePaid = async () => {
    setBusy(true);
    try {
      await api.markOrderPaid(o.id, !o.paid);
      invalidate();
      toast.show(o.paid ? "Marked as unpaid" : "Marked as paid", "success");
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setBusy(false); }
  };

  const startEditItems = () => {
    const qty: Record<string, string> = {};
    o.items.forEach((it, idx) => { qty[`${it.product_id}|${it.variation}|${idx}`] = String(it.quantity); });
    setDraftQty(qty);
    setRemoved({});
    setEditingItems(true);
  };

  const saveItems = async () => {
    setBusy(true);
    try {
      const items = o.items
        .map((it, idx) => {
          const k = `${it.product_id}|${it.variation}|${idx}`;
          if (removed[k]) return null;
          const q = parseInt(draftQty[k] || "0", 10) || 0;
          if (q <= 0) return null;
          return { product_id: it.product_id, variation: it.variation, quantity: q };
        })
        .filter(Boolean) as any[];
      if (items.length === 0) { toast.show("At least one line required", "error"); return; }
      await api.updateOrderItems(o.id, items);
      invalidate();
      setEditingItems(false);
      toast.show("Order updated", "success");
    } catch (e: any) { toast.show(e.message || "Failed", "error"); }
    finally { setBusy(false); }
  };

  const openInvoice = async () => {
    const url = api.invoiceUrl(o.id);
    const token = await tokenStore.get();
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { toast.show("Could not open invoice", "error"); return; }
      const blob = await res.blob();
      if (Platform.OS === "web") {
        const objectUrl = URL.createObjectURL(blob);
        (window as any).open(objectUrl, "_blank");
      } else {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          Linking.openURL(dataUrl).catch(() => toast.show("Open the invoice on the web preview to download the PDF", "info"));
        };
        reader.readAsDataURL(blob);
      }
    } catch {
      toast.show("Could not open invoice", "error");
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="admin-order-back" onPress={() => router.back()}><Text style={{ color: colors.brandPrimary }}>← Back</Text></Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={styles.title}>{o.order_number}</Text>
          <Text style={styles.meta}>{o.status}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120, gap: spacing.md }} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.section}>Customer</Text>
          <Text>{o.customer_name}</Text>
          <Text style={styles.meta}>{o.customer_company}</Text>
          <Text style={styles.meta}>{o.customer_phone}</Text>
          <Text style={styles.meta}>{o.customer_address}</Text>
        </View>

        {(o.invoice_issued_at || o.invoice_due_at) && (
          <View style={styles.card}>
            <Text style={styles.section}>Invoice</Text>
            {o.invoice_issued_at && <Text style={styles.line}>Issued: {new Date(o.invoice_issued_at).toLocaleDateString()}</Text>}
            {o.invoice_due_at && <Text style={styles.line}>Due: {new Date(o.invoice_due_at).toLocaleDateString()} ({o.payment_terms_days} days)</Text>}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
              <Text style={styles.label}>Paid</Text>
              <Switch value={o.paid} onValueChange={togglePaid} testID="toggle-paid" trackColor={{ true: colors.success, false: colors.border }} />
            </View>
            <Button testID="download-invoice-btn" title="Open invoice PDF" onPress={openInvoice} variant="secondary" style={{ marginTop: 8 }} />
          </View>
        )}

        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.section}>Items</Text>
            {canEdit && !editingItems && (
              <Pressable onPress={startEditItems} testID="edit-items-btn">
                <Text style={{ color: colors.brandPrimary, fontWeight: "500" }}>Edit</Text>
              </Pressable>
            )}
          </View>
          {o.items.map((it, idx) => {
            const k = `${it.product_id}|${it.variation}|${idx}`;
            const isRemoved = !!removed[k];
            return (
              <View key={idx} style={[styles.itemRow, isRemoved && { opacity: 0.4 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "500", color: colors.onSurface }}>{it.product_name}{it.variation ? ` — ${it.variation}` : ""}</Text>
                  <Text style={styles.meta}>{it.sku} · per {it.unit}</Text>
                  {editingItems ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>Qty</Text>
                      <TextInput
                        testID={`edit-qty-${idx}`}
                        style={styles.qtyInput}
                        value={draftQty[k] || "0"}
                        keyboardType="number-pad"
                        onChangeText={t => setDraftQty(prev => ({ ...prev, [k]: t.replace(/[^0-9]/g, "") }))}
                      />
                      <Pressable
                        testID={`edit-remove-${idx}`}
                        onPress={() => setRemoved(prev => ({ ...prev, [k]: !prev[k] }))}
                      >
                        <Text style={{ color: colors.error }}>{isRemoved ? "Restore" : "Remove"}</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Text style={styles.meta}>{it.quantity} × RM {it.unit_price.toFixed(2)}</Text>
                  )}
                </View>
                {!editingItems && <Text style={{ color: colors.brandPrimary, fontWeight: "600" }}>RM {it.line_total.toFixed(2)}</Text>}
              </View>
            );
          })}
          {!editingItems ? (
            <View style={styles.totalRow}>
              <Text style={{ fontWeight: "600" }}>Total</Text>
              <Text style={{ color: colors.brandPrimary, fontWeight: "700", fontSize: 18 }}>RM {o.total_amount.toFixed(2)}</Text>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Button testID="cancel-edit-items" title="Cancel" onPress={() => setEditingItems(false)} variant="secondary" style={{ flex: 1 }} />
              <Button testID="save-edit-items" title="Save changes" onPress={saveItems} loading={busy} style={{ flex: 1 }} />
            </View>
          )}
          {!canEdit && !editingItems && (
            <Text style={styles.hint}>Items cannot be edited: order is {o.status.toLowerCase()}{o.edo?.signed ? " and E-DO signed" : ""}.</Text>
          )}
        </View>

        {!!o.notes && (
          <View style={styles.card}>
            <Text style={styles.section}>Customer notes</Text>
            <Text>{o.notes}</Text>
          </View>
        )}

        {o.edo?.signed && (
          <View style={styles.card}>
            <Text style={styles.section}>E-DO signed</Text>
            <Text style={styles.line}>Signed by {o.edo.signer_name} on {o.edo.signed_at ? new Date(o.edo.signed_at).toLocaleString() : "-"}</Text>
            {!!o.edo.signature_url && (
              <Image source={{ uri: resolveImageUrl(o.edo.signature_url) }} style={styles.sig} contentFit="contain" />
            )}
            <Text style={[styles.section, { marginTop: 8 }]}>Photos ({o.edo.photo_urls.length})</Text>
            <ScrollView horizontal contentContainerStyle={{ gap: 8, paddingVertical: 4 }} showsHorizontalScrollIndicator={false}>
              {o.edo.photo_urls.map(u => (
                <Image key={u} source={{ uri: resolveImageUrl(u) }} style={styles.thumb} contentFit="cover" />
              ))}
            </ScrollView>
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
                disabled={busy || s === o.status}
                style={{
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                  backgroundColor: s === o.status ? colors.brandPrimary : colors.surface,
                  borderWidth: 1, borderColor: s === o.status ? colors.brandPrimary : colors.border,
                  opacity: busy && s !== o.status ? 0.5 : 1,
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
          <Button testID="save-notes" title="Save notes" onPress={saveNotes} loading={busy} style={{ marginTop: spacing.sm }} variant="secondary" />
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
  label: { color: colors.onSurface, fontWeight: "500" },
  line: { color: colors.onSurface, fontSize: 13, marginTop: 2 },
  itemRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 8 },
  notes: { minHeight: 60, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.onSurface, textAlignVertical: "top", backgroundColor: colors.surface },
  qtyInput: { width: 70, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6, textAlign: "center", backgroundColor: colors.surface, color: colors.onSurface },
  sig: { width: "100%", height: 100, marginTop: 8, backgroundColor: colors.surface, borderRadius: radius.sm },
  thumb: { width: 96, height: 96, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  hint: { color: colors.muted, fontSize: 12, marginTop: 6, fontStyle: "italic" },
});
