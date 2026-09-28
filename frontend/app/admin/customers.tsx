import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { View, Text, StyleSheet, FlatList, TextInput, RefreshControl } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/api";
import { colors, radius, spacing } from "@/src/theme";

export default function AdminCustomers() {
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const customers = useQuery({ queryKey: ["customers-admin", q], queryFn: () => api.listCustomers(q) });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={styles.title}>Customers</Text>
        <TextInput
          testID="cust-search"
          style={styles.search}
          value={q}
          onChangeText={setQ}
          placeholder="Search name / email / company"
          placeholderTextColor={colors.muted}
        />
      </View>
      <FlatList
        data={customers.data || []}
        keyExtractor={(c: any) => c.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={customers.isFetching} onRefresh={() => customers.refetch()} tintColor={colors.brandPrimary} />}
        ListEmptyComponent={<Text style={styles.empty}>No customers yet</Text>}
        renderItem={({ item }) => (
          <View style={styles.card} testID={`customer-${item.email}`}>
            <Text style={styles.name}>{item.name || item.email}</Text>
            <Text style={styles.meta}>{item.email}</Text>
            {!!item.company && <Text style={styles.meta}>{item.company}</Text>}
            {!!item.phone && <Text style={styles.meta}>{item.phone}</Text>}
            {!!item.address && <Text style={styles.meta}>{item.address}</Text>}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  title: { fontSize: 22, fontWeight: "600", color: colors.onSurface, marginBottom: spacing.sm },
  search: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 44, color: colors.onSurface },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  name: { fontWeight: "600", color: colors.onSurface },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  empty: { color: colors.muted, textAlign: "center", marginTop: spacing.xxl },
});
