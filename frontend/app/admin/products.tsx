import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { api, resolveImageUrl } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";
import { Button } from "@/src/button";
import { useToast } from "@/src/toast";

export default function AdminProducts() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const products = useQuery({ queryKey: ["products-admin"], queryFn: () => api.listProducts() });

  const toggleAvailable = async (id: string, current: boolean) => {
    setBusy(id);
    try {
      const p = await api.getProduct(id);
      await api.updateProduct(id, { ...p, available: !current });
      qc.invalidateQueries({ queryKey: ["products-admin"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.show("Updated", "success");
    } catch (e: any) { toast.show(e.message, "error"); }
    finally { setBusy(null); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Products</Text>
        <Button testID="new-product-btn" title="+ New product" onPress={() => router.push("/admin/product/edit")} variant="secondary" style={{ marginTop: 8 }} />
      </View>
      <FlatList
        data={products.data || []}
        keyExtractor={p => p.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={products.isFetching} onRefresh={() => products.refetch()} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={<Text style={styles.empty}>No products</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            testID={`admin-product-${item.sku}`}
            onPress={() => router.push({ pathname: "/admin/product/edit", params: { id: item.id } })}
          >
            <Image source={{ uri: resolveImageUrl(item.image_url) }} style={styles.img} contentFit="cover" />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>{item.sku} · RM {item.price.toFixed(2)}</Text>
              <Text style={styles.meta}>{item.variations.length} variations · {item.category}</Text>
              <Pressable
                testID={`toggle-avail-${item.sku}`}
                onPress={() => toggleAvailable(item.id, item.available)}
                disabled={busy === item.id}
                style={{
                  alignSelf: "flex-start", marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
                  backgroundColor: item.available ? "#DCEAE0" : "#F5D8D8",
                }}
              >
                <Text style={{ color: item.available ? colors.success : colors.error, fontSize: 12, fontWeight: "600" }}>
                  {item.available ? "Available" : "Unavailable"}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface },
  card: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  img: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  name: { fontWeight: "600", color: colors.onSurface },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  empty: { color: colors.muted, textAlign: "center", marginTop: spacing.xxl },
});
