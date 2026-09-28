// Design tokens for The Kitchen Atelier. Light theme only.
// Values from /app/design_guidelines.json.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#F9F7F3",
  onSurface: "#262422",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#262422",
  surfaceTertiary: "#F2EFE9",
  onSurfaceTertiary: "#4A4744",
  surfaceInverse: "#262422",
  onSurfaceInverse: "#FFFFFF",
  muted: "#7E7973",

  brand: "#BF5D39",
  onBrand: "#FFFFFF",
  brandPrimary: "#BF5D39",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#D88668",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#F4DFD7",
  onBrandTertiary: "#8F3D1F",

  success: "#4A7A59",
  onSuccess: "#FFFFFF",
  warning: "#E09838",
  onWarning: "#FFFFFF",
  error: "#B34B4B",
  onError: "#FFFFFF",
  info: "#4A6C7A",
  onInfo: "#FFFFFF",

  border: "#EBE6DF",
  borderStrong: "#D6CEC3",
  divider: "#EBE6DF",
};

export type ThemeColors = typeof light;
export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };
export const colors = light;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
export const fontSize = { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24 };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}
setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}
