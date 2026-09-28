import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, KeyboardAvoidingView, Platform, Switch } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api, resolveImageUrl, Variation } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

export default function ProductEdit() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [form, setForm] = useState({
    sku: "", name: "", description: "", category: "", image_url: "",
    unit: "pcs", price: "0", available: true, is_demo: false,
    track_stock: false, stock: "0",
  });
  const [variations, setVariations] = useState<Variation[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (id) {
      api.getProduct(id).then(p => {
        setForm({
          sku: p.sku, name: p.name, description: p.description, category: p.category,
          image_url: p.image_url, unit: p.unit, price: String(p.price),
          available: p.available, is_demo: p.is_demo,
          track_stock: p.track_stock, stock: String(p.stock),
        });
        setVariations(p.variations);
      }).catch((e) => toast.show(e.message, "error"));
    }
  }, [id]);

  const set = (k: keyof typeof form) => (v: any) => setForm(f => ({ ...f, [k]: v }));

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast.show("Permission denied", "error"); return; }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], quality: 0.7, allowsEditing: true, aspect: [1, 1],
    });
    if (res.canceled) return;
    const asset = res.assets[0];
    setUploading(true);
    try {
      const out = await api.uploadProductImage(asset.uri, asset.fileName || `img-${Date.now()}.jpg`, asset.mimeType || "image/jpeg");
      set("image_url")(out.url);
      toast.show("Image uploaded", "success");
    } catch (e: any) {
      toast.show(e.message || "Upload failed", "error");
    } finally { setUploading(false); }
  };

  const addVariation = () => setVariations(v => [...v, { name: "", price: 0, available: true, stock: 0 }]);
  const setVarField = (idx: number, k: keyof Variation, val: any) =>
    setVariations(v => v.map((x, i) => (i === idx ? { ...x, [k]: val } : x)));
  const removeVariation = (idx: number) => setVariations(v => v.filter((_, i) => i !== idx));

  const save = async () => {
    if (!form.sku || !form.name) { toast.show("SKU and name required", "error"); return; }
    setLoading(true);
    const payload = {
      sku: form.sku, name: form.name, description: form.description, category: form.category,
      image_url: form.image_url, unit: form.unit, price: parseFloat(form.price) || 0,
      available: form.available, is_demo: form.is_demo,
      track_stock: form.track_stock, stock: parseInt(form.stock || "0", 10) || 0,
      variations: variations
        .filter(v => v.name.trim())
        .map(v => ({ ...v, price: Number(v.price) || 0, stock: Number(v.stock) || 0 })),
    };
    try {
      if (id) await api.updateProduct(id, payload);
      else await api.createProduct(payload);
      qc.invalidateQueries({ queryKey: ["products-admin"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.show(id ? "Product updated" : "Product created", "success");
      router.back();
    } catch (e: any) { toast.show(e.message || "Save failed", "error"); }
    finally { setLoading(false); }
  };

  const del = async () => {
    if (!id) return;
    setLoading(true);
    try {
      await api.deleteProduct(id);
      qc.invalidateQueries({ queryKey: ["products-admin"] });
      toast.show("Deleted", "success");
      router.back();
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setLoading(false); }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Pressable testID="pe-back" onPress={() => router.back()}><Text style={{ color: colors.brandPrimary }}>← Back</Text></Pressable>
        <Text style={styles.title}>{id ? "Edit Product" : "New Product"}</Text>

        <Text style={styles.label}>Image</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Image source={{ uri: resolveImageUrl(form.image_url) }} style={styles.imgPreview} contentFit="cover" />
          <Button testID="pick-image-btn" title={uploading ? "Uploading..." : "Choose photo"} onPress={pickImage} loading={uploading} variant="secondary" />
        </View>

        <Field label="SKU *" testID="pe-sku" value={form.sku} onChangeText={set("sku")} />
        <Field label="Name *" testID="pe-name" value={form.name} onChangeText={set("name")} />
        <Field label="Description" testID="pe-desc" value={form.description} onChangeText={set("description")} multiline />
        <Field label="Category" testID="pe-category" value={form.category} onChangeText={set("category")} />
        <Field label="Unit (pcs, dozen, kg...)" testID="pe-unit" value={form.unit} onChangeText={set("unit")} />
        <Field label="Base price (RM)" testID="pe-price" value={form.price} onChangeText={set("price")} keyboardType="decimal-pad" />

        <View style={styles.switchRow}>
          <Text style={styles.label}>Available</Text>
          <Switch value={form.available} onValueChange={set("available")} trackColor={{ true: colors.brandPrimary, false: colors.border }} />
        </View>

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Track stock</Text>
            <Text style={styles.hint}>When on, orders that exceed stock are blocked.</Text>
          </View>
          <Switch value={form.track_stock} onValueChange={set("track_stock")} trackColor={{ true: colors.brandPrimary, false: colors.border }} />
        </View>

        {form.track_stock && variations.length === 0 && (
          <Field label="Base stock (units in warehouse)" testID="pe-stock" value={form.stock} onChangeText={set("stock")} keyboardType="number-pad" />
        )}

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Variations</Text>
        <Text style={styles.hint}>If a product has sizes / options, add them here. Each variation carries its own price and stock.</Text>
        {variations.map((v, i) => (
          <View key={i} style={styles.varCard} testID={`variation-row-${i}`}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput style={[styles.input, { flex: 2 }]} placeholder="Name (e.g. 20cm)" placeholderTextColor={colors.muted} value={v.name} onChangeText={t => setVarField(i, "name", t)} />
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="Price" placeholderTextColor={colors.muted} keyboardType="decimal-pad" value={String(v.price)} onChangeText={t => setVarField(i, "price", parseFloat(t) || 0)} />
              <Pressable onPress={() => removeVariation(i)} style={{ padding: 8 }}>
                <Text style={{ color: colors.error }}>✕</Text>
              </Pressable>
            </View>
            {form.track_stock && (
              <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Stock</Text>
                <TextInput
                  style={[styles.input, { width: 100 }]}
                  keyboardType="number-pad"
                  value={String(v.stock ?? 0)}
                  onChangeText={t => setVarField(i, "stock", parseInt(t || "0", 10) || 0)}
                />
              </View>
            )}
          </View>
        ))}
        <Button testID="add-variation-btn" title="+ Add variation" onPress={addVariation} variant="secondary" style={{ marginTop: 8 }} />

        <Button testID="save-product-btn" title="Save Product" onPress={save} loading={loading} style={{ marginTop: spacing.lg }} />
        {id && <Button testID="delete-product-btn" title="Delete Product" onPress={del} variant="danger" style={{ marginTop: spacing.md }} />}
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
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface, marginVertical: spacing.md },
  label: { color: colors.onSurface, fontWeight: "500", marginBottom: 6 },
  hint: { color: colors.muted, fontSize: 12, marginBottom: 4 },
  input: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 48, color: colors.onSurface, fontSize: 15, paddingVertical: 10 },
  imgPreview: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  varCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
});
