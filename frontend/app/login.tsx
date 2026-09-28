import { useState } from "react";
import { View, Text, TextInput, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

export default function Login() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email || !password) { toast.show("Enter email and password", "error"); return; }
    setLoading(true);
    try {
      const user = await login(email.trim(), password);
      if (user.role === "admin") router.replace("/admin/dashboard");
      else router.replace("/customer/home");
    } catch (e: any) {
      toast.show(e.message || "Login failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: colors.surface }}
    >
      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>The Kitchen Atelier</Text>
        <Text style={styles.subtitle}>Sign in to place your order</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          testID="login-email-input"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          testID="login-password-input"
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Your password"
          placeholderTextColor={colors.muted}
          secureTextEntry
        />

        <Button testID="login-submit-button" title="Sign in" onPress={submit} loading={loading} style={{ marginTop: spacing.lg }} />

        <Pressable testID="go-to-register" onPress={() => router.push("/register")} style={{ marginTop: spacing.xl, alignItems: "center" }}>
          <Text style={{ color: colors.brandPrimary, fontSize: 15 }}>New customer? Create an account</Text>
        </Pressable>

        <View style={styles.demoBox}>
          <Text style={styles.demoTitle}>Demo credentials</Text>
          <Text style={styles.demoLine}>Customer: customer@demo.com / Customer@2026</Text>
          <Text style={styles.demoLine}>Admin: admin@kitchenatelier.com / Admin@KA2026</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  brand: { fontSize: 28, fontWeight: "600", color: colors.onSurface },
  subtitle: { color: colors.muted, marginTop: 4, marginBottom: spacing.xl },
  label: { color: colors.onSurface, fontWeight: "500", marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontSize: 16, color: colors.onSurface, minHeight: 48,
  },
  demoBox: {
    marginTop: spacing.xxl, backgroundColor: colors.brandTertiary, padding: spacing.md, borderRadius: radius.md,
  },
  demoTitle: { fontWeight: "600", color: colors.onBrandTertiary, marginBottom: 4 },
  demoLine: { color: colors.onBrandTertiary, fontSize: 12 },
});
