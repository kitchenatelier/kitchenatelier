import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Switch,
  KeyboardAvoidingView, Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

export default function AdminSettings() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const toast = useToast();
  const { user, logout } = useAuth();
  const s = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings() });

  const [showPrices, setShowPrices] = useState(true);
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [terms, setTerms] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<null | "products" | "customers">(null);
  const [importResult, setImportResult] = useState<string>("");

  useEffect(() => {
    if (s.data) {
      setShowPrices(s.data.show_prices_to_customers);
      setContact(s.data.company_contact);
      setPhone(s.data.company_phone);
      setEmail(s.data.company_email);
      setAddress(s.data.company_address || "");
      setTerms(s.data.edo_terms_text || "");
    }
  }, [s.data]);

  const save = async () => {
    setLoading(true);
    try {
      await api.updateSettings({
        show_prices_to_customers: showPrices,
        company_contact: contact, company_phone: phone, company_email: email,
        company_address: address, edo_terms_text: terms,
      });
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.show("Settings saved", "success");
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setLoading(false); }
  };

  const pickAndImport = async (kind: "products" | "customers") => {
    const res = await DocumentPicker.getDocumentAsync({ type: "text/csv", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setImporting(kind);
    setImportResult("");
    try {
      const out = kind === "products"
        ? await api.importProductsCsv(asset.uri, asset.name || "products.csv")
        : await api.importCustomersCsv(asset.uri, asset.name || "customers.csv");
      qc.invalidateQueries({ queryKey: kind === "products" ? ["products-admin"] : ["customers-admin"] });
      const msg = `Imported ${out.imported} · Failed ${out.failed}` + (out.errors.length ? `\n${out.errors.join("\n")}` : "");
      setImportResult(msg);
      toast.show(`Imported ${out.imported} ${kind}`, "success");
    } catch (e: any) {
      setImportResult(e.message || "Import failed");
      toast.show(e.message || "Import failed", "error");
    } finally { setImporting(null); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Signed in as {user?.email}</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Show prices to customers</Text>
              <Text style={styles.meta}>When off, prices are hidden but ordering still works.</Text>
            </View>
            <Switch
              testID="toggle-show-prices"
              value={showPrices}
              onValueChange={setShowPrices}
              trackColor={{ true: colors.brandPrimary, false: colors.border }}
            />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Company info</Text>
          <TextInput testID="setting-contact" style={styles.input} value={contact} onChangeText={setContact} placeholder="Contact name" placeholderTextColor={colors.muted} />
          <TextInput testID="setting-phone" style={styles.input} value={phone} onChangeText={setPhone} placeholder="Phone" placeholderTextColor={colors.muted} />
          <TextInput testID="setting-email" style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.muted} autoCapitalize="none" />
          <TextInput testID="setting-address" style={[styles.input, { minHeight: 60 }]} multiline value={address} onChangeText={setAddress} placeholder="Address (shows on invoices)" placeholderTextColor={colors.muted} />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Electronic Delivery Order (E-DO) terms</Text>
          <Text style={styles.meta}>This text is shown to the customer when they sign the E-DO on receipt.</Text>
          <TextInput
            testID="setting-edo-terms"
            style={[styles.input, { minHeight: 140, textAlignVertical: "top" }]}
            multiline
            value={terms}
            onChangeText={setTerms}
            placeholderTextColor={colors.muted}
          />
        </View>

        <Button testID="save-settings" title="Save settings" onPress={save} loading={loading} />

        <View style={[styles.card, { marginTop: spacing.lg }]}>
          <Text style={styles.label}>Bulk import (CSV)</Text>
          <Text style={styles.meta}>
            Products columns: sku, name, description, category, unit, price, track_stock, stock, variation, variation_price, variation_stock. One row per variation (same sku groups them).{"\n"}
            Customers columns: email, password, name, company, phone, address, payment_terms_days. Password is only needed for new customers.
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Button
              testID="import-products-csv"
              title={importing === "products" ? "Importing..." : "Import products"}
              onPress={() => pickAndImport("products")}
              loading={importing === "products"}
              variant="secondary"
              style={{ flex: 1 }}
            />
            <Button
              testID="import-customers-csv"
              title={importing === "customers" ? "Importing..." : "Import customers"}
              onPress={() => pickAndImport("customers")}
              loading={importing === "customers"}
              variant="secondary"
              style={{ flex: 1 }}
            />
          </View>
          {!!importResult && <Text testID="import-result" style={styles.importResult}>{importResult}</Text>}
        </View>

        <Button testID="admin-logout" title="Sign out" onPress={logout} variant="secondary" style={{ marginTop: spacing.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "600", color: colors.onSurface },
  subtitle: { color: colors.muted, marginTop: 4, marginBottom: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  label: { color: colors.onSurface, fontWeight: "500" },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44, color: colors.onSurface, marginTop: 8, paddingVertical: 10, fontSize: 14 },
  importResult: { marginTop: 8, color: colors.onSurface, fontSize: 12, backgroundColor: colors.surface, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.divider },
});
