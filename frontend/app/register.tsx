import { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

export default function Register() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { register } = useAuth();
  const toast = useToast();

  const [form, setForm] = useState({
    email: "", password: "", name: "", company: "", phone: "", address: "", delivery_instructions: "",
  });
  const [loading, setLoading] = useState(false);

  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.email || !form.password || !form.name) {
      toast.show("Email, password and name are required", "error"); return;
    }
    if (form.password.length < 6) { toast.show("Password must be at least 6 characters", "error"); return; }
    setLoading(true);
    try {
      await register({ ...form, email: form.email.trim() });
      toast.show("Welcome!", "success");
      router.replace("/customer/home");
    } catch (e: any) {
      toast.show(e.message || "Registration failed", "error");
    } finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable testID="back-to-login" onPress={() => router.back()} style={{ marginBottom: spacing.lg }}>
          <Text style={{ color: colors.brandPrimary }}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>Create account</Text>

        <Field label="Email *" testID="reg-email" value={form.email} onChangeText={set("email")} autoCapitalize="none" keyboardType="email-address" />
        <Field label="Password *" testID="reg-password" value={form.password} onChangeText={set("password")} secureTextEntry />
        <Field label="Full name *" testID="reg-name" value={form.name} onChangeText={set("name")} />
        <Field label="Company / Business" testID="reg-company" value={form.company} onChangeText={set("company")} />
        <Field label="Phone" testID="reg-phone" value={form.phone} onChangeText={set("phone")} keyboardType="phone-pad" />
        <Field label="Delivery address" testID="reg-address" value={form.address} onChangeText={set("address")} multiline />
        <Field label="Delivery instructions" testID="reg-instructions" value={form.delivery_instructions} onChangeText={set("delivery_instructions")} multiline />

        <Button testID="register-submit-button" title="Create account" onPress={submit} loading={loading} style={{ marginTop: spacing.lg }} />
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
        style={[styles.input, props.multiline && { minHeight: 80, textAlignVertical: "top", paddingVertical: 12 }]}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "600", color: colors.onSurface },
  label: { color: colors.onSurface, fontWeight: "500", marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 16, color: colors.onSurface, minHeight: 48, paddingVertical: 10,
  },
});
