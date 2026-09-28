import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, ScrollView, FlatList, Pressable, TextInput, RefreshControl } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { api, Product, resolveImageUrl } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

export default function Products() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");

  const products = useQuery({
    queryKey: ["products", q, category],
    queryFn: () => api.listProducts(q, category),
  });
  const categories = useQuery({ queryKey: ["categories"], queryFn: () => api.getCategories() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.getSettings() });

  const showPrices = settings.data?.show_prices_to_customers ?? true;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Products</Text>
        <TextInput
          testID="products-search-input"
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="Search by name or SKU"
          placeholderTextColor={colors.muted}
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}
          style={{ maxHeight: 56 }}
        >
          <Chip label="All" active={!category} onPress={() => setCategory("")} testID="cat-all" />
          {(categories.data || []).map(c => (
            <Chip key={c} label={c} active={category === c} onPress={() => setCategory(c)} testID={`cat-${c}`} />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={products.data || []}
        keyExtractor={p => p.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={products.isFetching} onRefresh={() => products.refetch()} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={<Text testID="products-empty" style={styles.empty}>No products found</Text>}
        renderItem={({ item }) => (
          <ProductRow
            product={item}
            showPrice={showPrices}
            onPress={() => router.push(`/customer/product/${item.id}`)}
          />
        )}
      />
    </View>
  );
}

function Chip({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={{
        flexShrink: 0,
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 999,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: active ? colors.brandPrimary : colors.surfaceSecondary,
        borderWidth: 1,
        borderColor: active ? colors.brandPrimary : colors.border,
      }}
    >
      <Text style={{ color: active ? colors.onBrandPrimary : colors.onSurface, fontWeight: "500", fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function ProductRow({ product, showPrice, onPress }: { product: Product; showPrice: boolean; onPress: () => void }) {
  return (
    <Pressable testID={`product-row-${product.sku}`} onPress={onPress} style={styles.row}>
      <Image
        source={{ uri: resolveImageUrl(product.image_url) }}
        style={styles.img}
        contentFit="cover"
        transition={200}
      />
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <Text numberOfLines={2} style={styles.rowName}>{product.name}</Text>
        <Text style={styles.rowMeta}>{product.sku} · {product.unit}</Text>
        <Text style={styles.rowMeta}>{product.category}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6, justifyContent: "space-between" }}>
          {showPrice ? (
            <Text style={styles.price}>
              {product.variations.length > 0 ? "from " : ""}RM {(product.variations[0]?.price ?? product.price).toFixed(2)}
            </Text>
          ) : (
            <Text style={styles.priceHidden}>Price confirmed after review</Text>
          )}
          {product.variations.length > 0 && (
            <Text style={styles.variantHint}>{product.variations.length} sizes</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, paddingBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  search: {
    marginHorizontal: spacing.lg, backgroundColor: colors.surfaceSecondary,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, minHeight: 44, color: colors.onSurface, fontSize: 15,
  },
  empty: { color: colors.muted, textAlign: "center", marginTop: spacing.xxl },
  row: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.md,
    padding: spacing.md, flexDirection: "row", borderWidth: 1, borderColor: colors.border,
  },
  img: { width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
  rowName: { fontWeight: "600", color: colors.onSurface, fontSize: 15 },
  rowMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  price: { color: colors.brandPrimary, fontWeight: "600", fontSize: 15 },
  priceHidden: { color: colors.muted, fontSize: 12, fontStyle: "italic" },
  variantHint: { color: colors.onSurfaceTertiary, fontSize: 12 },
});
