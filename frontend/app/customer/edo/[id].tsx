import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import SignatureScreen, { SignatureViewRef } from "react-native-signature-canvas";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, resolveImageUrl } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

export default function EdoScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const sigRef = useRef<SignatureViewRef>(null);

  const order = useQuery({ queryKey: ["order", id], queryFn: () => api.getOrder(id!) });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings() });

  const [signerName, setSignerName] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const addPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast.show("Photo permission denied", "error"); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], quality: 0.7,
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    setUploading(true);
    try {
      const out = await api.uploadEdoPhoto(id!, asset.uri, asset.fileName || `photo-${Date.now()}.jpg`, asset.mimeType || "image/jpeg");
      setPhotos(p => [...p, out.url]);
      toast.show("Photo added", "success");
    } catch (e: any) { toast.show(e.message || "Upload failed", "error"); }
    finally { setUploading(false); }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { toast.show("Camera permission denied", "error"); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (res.canceled) return;
    const asset = res.assets[0];
    setUploading(true);
    try {
      const out = await api.uploadEdoPhoto(id!, asset.uri, asset.fileName || `photo-${Date.now()}.jpg`, asset.mimeType || "image/jpeg");
      setPhotos(p => [...p, out.url]);
      toast.show("Photo added", "success");
    } catch (e: any) { toast.show(e.message || "Upload failed", "error"); }
    finally { setUploading(false); }
  };

  const removePhoto = (url: string) => setPhotos(p => p.filter(x => x !== url));

  const captureSignature = () => {
    // Ask the signature canvas to emit its data URL through onOK
    sigRef.current?.readSignature();
  };

  const submit = async () => {
    if (!signerName.trim()) { toast.show("Please type your name", "error"); return; }
    if (!signatureDataUrl) {
      toast.show("Tap 'Save signature' first", "error");
      return;
    }
    if (photos.length === 0) { toast.show("Add at least one photo", "error"); return; }
    setSubmitting(true);
    try {
      await api.submitEdo(id!, {
        signer_name: signerName.trim(),
        signature_data_url: signatureDataUrl,
        photo_urls: photos,
        accepted_terms: true,
      });
      toast.show("E-DO signed. Thank you!", "success");
      router.replace(`/customer/order/${id}`);
    } catch (e: any) { toast.show(e.message || "Submit failed", "error"); }
    finally { setSubmitting(false); }
  };

  const o = order.data;
  const terms = settings.data?.edo_terms_text || "";

  // Web style for the underlying WebView canvas
  const sigWebStyle = `
    body,html { margin:0; padding:0; background:#F9F7F3; }
    .m-signature-pad { box-shadow:none; border:none; margin:0; }
    .m-signature-pad--body { border:none; }
    .m-signature-pad--footer { display:none; }
    canvas { background:#FFFFFF; }
  `;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="edo-back" onPress={() => router.back()}><Text style={{ color: colors.brandPrimary }}>← Back</Text></Pressable>
        <Text style={styles.title}>Sign E-DO</Text>
        {o && <Text style={styles.meta}>Order {o.order_number}</Text>}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160 }} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.section}>1. Your name</Text>
          <TextInput
            testID="edo-signer-name"
            style={styles.input}
            value={signerName}
            onChangeText={setSignerName}
            placeholder="Full name of person receiving"
            placeholderTextColor={colors.muted}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>2. Photo(s) of received goods</Text>
          <Text style={styles.hint}>Please add at least one photo of the box. If the company name isn&apos;t written on it, sign anyway — this E-DO still counts as full acknowledgement of receipt.</Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Button testID="edo-take-photo" title="Take photo" onPress={takePhoto} variant="secondary" style={{ flex: 1 }} loading={uploading} />
            <Button testID="edo-pick-photo" title="From gallery" onPress={addPhoto} variant="secondary" style={{ flex: 1 }} loading={uploading} />
          </View>
          {photos.length > 0 && (
            <ScrollView horizontal contentContainerStyle={{ gap: 8, marginTop: 8 }} showsHorizontalScrollIndicator={false}>
              {photos.map(u => (
                <Pressable
                  key={u}
                  onLongPress={() => removePhoto(u)}
                  testID={`edo-photo-${photos.indexOf(u)}`}
                  style={styles.thumbWrap}
                >
                  <Image source={{ uri: resolveImageUrl(u) }} style={styles.thumb} contentFit="cover" />
                  <Pressable onPress={() => removePhoto(u)} style={styles.thumbRemove}>
                    <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "700" }}>✕</Text>
                  </Pressable>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>3. Sign here</Text>
          <View style={styles.sigBox}>
            <SignatureScreen
              ref={sigRef}
              onOK={(data) => setSignatureDataUrl(data)}
              onEmpty={() => toast.show("Please draw your signature first", "error")}
              webStyle={sigWebStyle}
              backgroundColor="#FFFFFF"
              penColor={colors.onSurface}
              descriptionText=""
              autoClear={false}
              trimWhitespace={false}
            />
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
            <Button
              testID="edo-clear-sig"
              title="Clear"
              onPress={() => { sigRef.current?.clearSignature(); setSignatureDataUrl(""); }}
              variant="secondary"
              style={{ flex: 1 }}
            />
            <Button
              testID="edo-save-sig"
              title={signatureDataUrl ? "Signature saved ✓" : "Save signature"}
              onPress={captureSignature}
              variant={signatureDataUrl ? "secondary" : "primary"}
              style={{ flex: 1 }}
            />
          </View>
          {signatureDataUrl ? (
            <Image source={{ uri: signatureDataUrl }} style={styles.sigPreview} contentFit="contain" />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.section}>Terms &amp; conditions (accepted at login)</Text>
          <Text style={styles.termsText}>{terms}</Text>
          <Text style={[styles.hint, { marginTop: 6 }]}>You already accepted these terms when you signed in. They apply to this delivery.</Text>
        </View>

        <Button
          testID="edo-submit"
          title="Submit E-DO"
          onPress={submit}
          loading={submitting}
          disabled={!signerName || !signatureDataUrl || photos.length === 0}
          style={{ marginTop: spacing.md }}
        />
        {uploading && <ActivityIndicator style={{ marginTop: 8 }} color={colors.brandPrimary} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface, marginTop: 4 },
  meta: { color: colors.muted, marginTop: 2 },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  section: { fontWeight: "600", color: colors.onSurface, fontSize: 15, marginBottom: 6 },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48, color: colors.onSurface, fontSize: 15 },
  sigBox: { height: 220, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: "hidden", backgroundColor: "#FFFFFF" },
  sigPreview: { width: "100%", height: 80, marginTop: 8, backgroundColor: colors.surface, borderRadius: radius.sm },
  termsText: { color: colors.onSurface, fontSize: 13, lineHeight: 19 },
  acceptRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.md, gap: 10 },
  checkbox: { width: 24, height: 24, borderRadius: 4, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  thumbWrap: { position: "relative" },
  thumb: { width: 96, height: 96, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  thumbRemove: {
    position: "absolute", top: -6, right: -6, backgroundColor: colors.error,
    width: 22, height: 22, borderRadius: 999, alignItems: "center", justifyContent: "center",
  },
});
