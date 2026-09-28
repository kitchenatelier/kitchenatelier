import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  View, Text, StyleSheet, FlatList, TextInput, RefreshControl,
  Modal, Pressable, KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

export default function AdminCustomers() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const customers = useQuery({ queryKey: ["customers-admin", q], queryFn: () => api.listCustomers(q) });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Customers</Text>
        <TextInput
          testID="cust-search"
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="Search name / email / company"
          placeholderTextColor={colors.muted}
        />
        <Button
          testID="new-customer-btn"
          title="+ Add customer"
          onPress={() => setModalOpen(true)}
          variant="secondary"
          style={{ marginTop: spacing.sm }}
        />
      </View>
      <FlatList
        data={customers.data || []}
        keyExtractor={(c: any) => c.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={customers.isFetching} onRefresh={() => customers.refetch()} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={<Text style={styles.empty}>No customers yet</Text>}
        renderItem={({ item }) => (
          <View style={styles.card} testID={`customer-${item.email}`}>
            <Text style={styles.name}>{item.name || item.email}</Text>
            <Text style={styles.meta}>{item.email}</Text>
            {!!item.company && <Text style={styles.meta}>{item.company}</Text>}
            {!!item.phone && <Text style={styles.meta}>{item.phone}</Text>}
            {!!item.address && <Text style={styles.meta}>{item.address}</Text>}
          </View>
        )}
      />

      <NewCustomerModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setModalOpen(false);
          qc.invalidateQueries({ queryKey: ["customers-admin"] });
          toast.show("Customer added. Share the temporary password with them.", "success");
        }}
      />
    </View>
  );
}

function NewCustomerModal({
  visible, onClose, onCreated,
}: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [form, setForm] = useState({
    email: "", password: "", name: "", company: "", phone: "", address: "", delivery_instructions: "",
  });
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const genPwd = () => {
    // Simple 10-char temp password: letters + digits + one symbol
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz";
    let s = "";
    for (let i = 0; i < 9; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s + "!";
  };

  const reset = () => setForm({ email: "", password: "", name: "", company: "", phone: "", address: "", delivery_instructions: "" });

  const submit = async () => {
    if (!form.email || !form.password || !form.name) {
      toast.show("Email, password and name are required", "error"); return;
    }
    if (form.password.length < 6) { toast.show("Password must be at least 6 characters", "error"); return; }
    setLoading(true);
    try {
      await api.createCustomer({ ...form, email: form.email.trim() });
      reset();
      onCreated();
    } catch (e: any) {
      toast.show(e.message || "Could not create customer", "error");
    } finally { setLoading(false); }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
        <View style={[styles.modalHeader, { paddingTop: insets.top + spacing.md }]}>
          <Pressable testID="new-cust-close" onPress={() => { reset(); onClose(); }}>
            <Text style={{ color: colors.brandPrimary, fontSize: 16 }}>Cancel</Text>
          </Pressable>
          <Text style={styles.modalTitle}>New customer</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
          <View style={styles.hint}>
            <Text style={styles.hintText}>
              You&apos;re creating the account on behalf of the customer. Share the temporary password with them so they can sign in and update it later from their Account tab.
            </Text>
          </View>

          <Field label="Email *" testID="nc-email" value={form.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" />

          <View style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={styles.label}>Temporary password *</Text>
              <Pressable testID="nc-generate-pwd" onPress={() => set("password")(genPwd())}>
                <Text style={{ color: colors.brandPrimary, fontSize: 13 }}>Generate</Text>
              </Pressable>
            </View>
            <TextInput
              testID="nc-password"
              value={form.password}
              onChangeText={set("password")}
              placeholder="Min 6 characters"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="none"
            />
          </View>

          <Field label="Full name *" testID="nc-name" value={form.name} onChangeText={set("name")} />
          <Field label="Company / Business" testID="nc-company" value={form.company} onChangeText={set("company")} />
          <Field label="Phone" testID="nc-phone" value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
          <Field label="Delivery address" testID="nc-address" value={form.address} onChangeText={set("address")} multiline />
          <Field label="Delivery instructions" testID="nc-instructions" value={form.delivery_instructions} onChangeText={set("delivery_instructions")} multiline />

          <Button testID="nc-submit" title="Create customer" onPress={submit} loading={loading} style={{ marginTop: spacing.lg }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field(props: any) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.muted}
        style={[styles.input, props.multiline && { minHeight: 80, textAlignVertical: "top" }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface, marginBottom: spacing.sm },
  search: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44, color: colors.onSurface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  name: { fontWeight: "600", color: colors.onSurface },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  empty: { color: colors.muted, textAlign: "center", marginTop: spacing.xxl },

  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingBottom: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: colors.surface,
  },
  modalTitle: { fontSize: 17, fontWeight: "600", color: colors.onSurface },
  hint: { backgroundColor: colors.brandTertiary, padding: spacing.md, borderRadius: radius.md },
  hintText: { color: colors.onBrandTertiary, fontSize: 13, lineHeight: 18 },
  label: { color: colors.onSurface, fontWeight: "500", marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10,
    fontSize: 15, color: colors.onSurface, minHeight: 48,
  },
});
