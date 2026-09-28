import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth";
import { colors } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.role === "admin") router.replace("/admin/dashboard");
    else router.replace("/customer/home");
  }, [user, loading, router]);

  return (
    <View
      testID="index-loading"
      style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}
    >
      <ActivityIndicator color={colors.brandPrimary} />
    </View>
  );
}
