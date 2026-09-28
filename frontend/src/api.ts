import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const KEY = "ka_access_token";

export const tokenStore = {
  get: () =>
    Platform.OS === "web" ? AsyncStorage.getItem(KEY) : SecureStore.getItemAsync(KEY),
  set: (t: string) =>
    Platform.OS === "web" ? AsyncStorage.setItem(KEY, t) : SecureStore.setItemAsync(KEY, t),
  clear: () =>
    Platform.OS === "web" ? AsyncStorage.removeItem(KEY) : SecureStore.deleteItemAsync(KEY),
};

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export type User = {
  id: string;
  email: string;
  role: "customer" | "admin";
  name: string;
  company: string;
  phone: string;
  address: string;
  delivery_instructions: string;
};

export type Variation = { name: string; price: number; available: boolean };
export type Product = {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  image_url: string;
  unit: string;
  price: number;
  variations: Variation[];
  available: boolean;
  is_demo: boolean;
};

export type OrderItem = {
  product_id: string;
  product_name: string;
  sku: string;
  variation: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
};

export type Order = {
  id: string;
  order_number: string;
  customer_id: string;
  customer_name: string;
  customer_company: string;
  customer_phone: string;
  customer_address: string;
  items: OrderItem[];
  total_amount: number;
  notes: string;
  admin_notes: string;
  customer_facing_notes: string;
  status: string;
  status_history: any[];
  created_at: string;
  updated_at: string;
};

export type Notification = {
  id: string;
  order_id: string;
  order_number: string;
  status: string;
  message: string;
  created_at: string;
  read: boolean;
};

export type Settings = {
  show_prices_to_customers: boolean;
  company_contact: string;
  company_phone: string;
  company_email: string;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!BASE) throw new Error("Missing EXPO_PUBLIC_BACKEND_URL");
  const token = await tokenStore.get();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = (data && data.detail) || `HTTP ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data as T;
}

export const api = {
  // auth
  register: (body: { email: string; password: string; name: string; company?: string; phone?: string; address?: string; delivery_instructions?: string; }) =>
    request<{ access_token: string; user: User }>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (email: string, password: string) =>
    request<{ access_token: string; user: User }>("/auth/login", {
      method: "POST", body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>("/auth/me"),
  updateMe: (body: Partial<User>) => request<User>("/auth/me", { method: "PUT", body: JSON.stringify(body) }),

  // products
  listProducts: (q = "", category = "") => {
    const p = new URLSearchParams();
    if (q) p.append("q", q);
    if (category) p.append("category", category);
    return request<Product[]>(`/products${p.toString() ? "?" + p.toString() : ""}`);
  },
  getCategories: () => request<string[]>("/products/categories"),
  getProduct: (id: string) => request<Product>(`/products/${id}`),
  createProduct: (body: any) => request<Product>("/products", { method: "POST", body: JSON.stringify(body) }),
  updateProduct: (id: string, body: any) => request<Product>(`/products/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteProduct: (id: string) => request<{ ok: boolean }>(`/products/${id}`, { method: "DELETE" }),

  uploadProductImage: async (uri: string, name: string, type: string) => {
    const form = new FormData();
    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      form.append("file", blob, name);
    } else {
      form.append("file", { uri, name, type } as any);
    }
    return request<{ path: string; url: string }>("/products/upload-image", { method: "POST", body: form });
  },

  // orders
  createOrder: (items: { product_id: string; variation: string; quantity: number }[], notes: string, client_ref: string) =>
    request<Order>("/orders", { method: "POST", body: JSON.stringify({ items, notes, client_ref }) }),
  listOrders: (statusFilter = "", q = "") => {
    const p = new URLSearchParams();
    if (statusFilter) p.append("status_filter", statusFilter);
    if (q) p.append("q", q);
    return request<Order[]>(`/orders${p.toString() ? "?" + p.toString() : ""}`);
  },
  getOrder: (id: string) => request<Order>(`/orders/${id}`),
  updateOrderStatus: (id: string, status: string, note = "") =>
    request<Order>(`/orders/${id}/status`, {
      method: "PUT", body: JSON.stringify({ status, customer_facing_note: note }),
    }),
  updateOrderNotes: (id: string, admin_notes?: string, customer_facing_notes?: string) =>
    request<Order>(`/orders/${id}/notes`, {
      method: "PUT",
      body: JSON.stringify({ admin_notes, customer_facing_notes }),
    }),
  dashboardSummary: () => request<{ counts: Record<string, number>; total: number }>("/orders/dashboard/summary"),

  // customers
  listCustomers: (q = "") => request<any[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`),

  // notifications
  listNotifications: () => request<Notification[]>("/notifications"),
  markNotificationRead: (id: string) => request(`/notifications/${id}/read`, { method: "POST" }),

  // settings
  getSettings: () => request<Settings>("/settings"),
  updateSettings: (body: Partial<Settings>) =>
    request<Settings>("/settings", { method: "PUT", body: JSON.stringify(body) }),

  orderStatuses: () => request<string[]>("/order-statuses"),
};

export function resolveImageUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("/api/")) return `${BASE}${url}`;
  return url;
}
