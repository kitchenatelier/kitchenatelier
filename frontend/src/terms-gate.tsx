import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Modal, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

export function TermsGate() {
  const { user, refresh } = useAuth();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [termsText, setTermsText] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);

  const mustShow = !!user && user.role === "customer" && user.must_accept_terms;

  useEffect(() => {
    let cancelled = false;
    if (mustShow && loadedForUser !== user?.id) {
      api.getSettings().then(s => {
        if (!cancelled) {
          setTermsText(s.edo_terms_text || "");
          setLoadedForUser(user!.id);
        }
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [mustShow, user, loadedForUser]);

  const submit = async () => {
    if (!accepted) return;
    setLoading(true);
    try {
      await api.acceptTerms();
      await refresh();
      toast.show("Thank you", "success");
    } catch (e: any) {
      toast.show(e.message || "Could not save acceptance", "error");
    } finally { setLoading(false); }
  };

  return (
    <Modal visible={mustShow} animationType="fade" transparent={false} onRequestClose={() => {}}>
      <View style={[styles.container, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.title}>Delivery Order — Terms & Conditions</Text>
        <Text style={styles.subtitle}>
          Please read and agree to the terms below. You only need to do this once. When you receive goods later, you will still sign each Electronic Delivery Order, but will not need to tick the T&C again.
        </Text>
        <ScrollView style={styles.termsBox} contentContainerStyle={{ padding: spacing.md }}>
          <Text style={styles.termsText}>{termsText || "Loading terms..."}</Text>
        </ScrollView>
        <Pressable
          testID="tc-accept-checkbox"
          onPress={() => setAccepted(a => !a)}
          style={styles.checkRow}
        >
          <View style={[styles.checkbox, accepted && { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary }]}>
            {accepted && <Text style={{ color: "#FFF", fontSize: 14, fontWeight: "700" }}>✓</Text>}
          </View>
          <Text style={{ flex: 1, color: colors.onSurface, fontSize: 14 }}>
            I have read and agree to the terms above.
          </Text>
        </Pressable>
        <Button
          testID="tc-agree-continue"
          title="Agree & continue"
          onPress={submit}
          loading={loading}
          disabled={!accepted || !termsText}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: spacing.lg },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface },
  subtitle: { color: colors.muted, marginTop: 6, marginBottom: spacing.md, fontSize: 13, lineHeight: 18 },
  termsBox: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, marginBottom: spacing.md },
  termsText: { color: colors.onSurface, fontSize: 13, lineHeight: 19 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: spacing.md },
  checkbox: { width: 24, height: 24, borderRadius: 4, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
