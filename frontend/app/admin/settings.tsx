import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, TextInput, Switch, KeyboardAvoidingView, Platform } from "react-native";
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (s.data) {
      setShowPrices(s.data.show_prices_to_customers);
      setContact(s.data.company_contact);
      setPhone(s.data.company_phone);
      setEmail(s.data.company_email);
    }
  }, [s.data]);

  const save = async () => {
    setLoading(true);
    try {
      await api.updateSettings({
        show_prices_to_customers: showPrices,
        company_contact: contact, company_phone: phone, company_email: email,
      });
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast.show("Settings saved", "success");
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg, paddingBottom: 120 }}>
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
          <Text style={styles.label}>Company info (customers can see)</Text>
          <TextInput testID="setting-contact" style={styles.input} value={contact} onChangeText={setContact} placeholder="Contact name" placeholderTextColor={colors.muted} />
          <TextInput testID="setting-phone" style={styles.input} value={phone} onChangeText={setPhone} placeholder="Phone" placeholderTextColor={colors.muted} />
          <TextInput testID="setting-email" style={styles.input} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.muted} autoCapitalize="none" />
        </View>

        <Button testID="save-settings" title="Save settings" onPress={save} loading={loading} />
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
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44, color: colors.onSurface, marginTop: 8 },
});
