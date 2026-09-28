import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View, Animated } from "react-native";
import { colors, radius, spacing } from "./theme";

type ToastType = "success" | "error" | "info";
type Toast = { id: number; message: string; type: ToastType };

const Ctx = createContext<{ show: (m: string, t?: ToastType) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <View pointerEvents="none" style={styles.host} testID="toast-host">
        {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
      </View>
    </Ctx.Provider>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [opacity]);
  const bg =
    toast.type === "success" ? colors.success :
    toast.type === "error" ? colors.error : colors.surfaceInverse;
  return (
    <Animated.View style={[styles.toast, { backgroundColor: bg, opacity }]} testID="toast-item">
      <Text style={styles.toastText}>{toast.message}</Text>
    </Animated.View>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside provider");
  return c;
}

const styles = StyleSheet.create({
  host: {
    position: "absolute", top: 60, left: 0, right: 0,
    alignItems: "center", zIndex: 9999, gap: spacing.sm,
  },
  toast: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.md, maxWidth: "90%",
    shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  toastText: { color: "#FFFFFF", fontSize: 14, fontWeight: "500" },
});
