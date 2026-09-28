import React from "react";
import { Pressable, StyleSheet, Text, ActivityIndicator, View, ViewStyle } from "react-native";
import { colors, radius, spacing } from "./theme";

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  title, onPress, variant = "primary", loading, disabled, testID, style, icon,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
  icon?: React.ReactNode;
}) {
  const isDisabled = disabled || loading;
  const bg =
    variant === "primary" ? colors.brandPrimary :
    variant === "secondary" ? colors.surfaceSecondary :
    variant === "danger" ? colors.error : "transparent";
  const fg =
    variant === "primary" ? colors.onBrandPrimary :
    variant === "danger" ? colors.onError :
    variant === "secondary" ? colors.onSurfaceSecondary : colors.brandPrimary;
  const border =
    variant === "secondary" ? colors.border : variant === "ghost" ? "transparent" : "transparent";

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border, borderWidth: variant === "secondary" ? 1 : 0 },
        isDisabled && { opacity: 0.5 },
        pressed && !isDisabled && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={[styles.txt, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  txt: { fontSize: 16, fontWeight: "600" },
});
