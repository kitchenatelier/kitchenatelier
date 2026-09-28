import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

export default function Account() {
  const insets = useSafeAreaInsets();
  const { user, updateUser, logout } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", company: "", phone: "", address: "", delivery_instructions: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) setForm({
      name: user.name || "", company: user.company || "", phone: user.phone || "",
      address: user.address || "", delivery_instructions: user.delivery_instructions || "",
    });
  }, [user]);

  const save = async () => {
    setSaving(true);
    try {
      await updateUser(form);
      toast.show("Profile updated", "success");
    } catch (e: any) {
      toast.show(e.message || "Update failed", "error");
    } finally { setSaving(false); }
  };

  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg, paddingBottom: 120 }}>
        <Text style={styles.title}>My Account</Text>
        <Text style={styles.email}>{user?.email}</Text>

        <Field label="Name" testID="acc-name" value={form.name} onChangeText={set("name")} />
        <Field label="Company / Business" testID="acc-company" value={form.company} onChangeText={set("company")} />
        <Field label="Phone" testID="acc-phone" value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
        <Field label="Delivery address" testID="acc-address" value={form.address} onChangeText={set("address")} multiline />
        <Field label="Delivery instructions" testID="acc-instructions" value={form.delivery_instructions} onChangeText={set("delivery_instructions")} multiline />

        <Button testID="acc-save" title="Save changes" onPress={save} loading={saving} style={{ marginTop: spacing.lg }} />
        <Button testID="acc-logout" title="Sign out" onPress={logout} variant="secondary" style={{ marginTop: spacing.md }} />
      </ScrollView>
    </KeyboardAvoidingView>
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
  title: { fontSize: 24, fontWeight: "600", color: colors.onSurface },
  email: { color: colors.muted, marginTop: 4 },
  label: { color: colors.onSurface, fontWeight: "500", marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, color: colors.onSurface, minHeight: 48, fontSize: 15,
  },
});
