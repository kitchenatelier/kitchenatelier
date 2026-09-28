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
  payment_terms_days: number;
};

export type Variation = { name: string; price: number; available: boolean; stock: number };
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
  track_stock: boolean;
  stock: number;
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

export type Edo = {
  signed: boolean;
  signed_at: string | null;
  signer_name: string;
  signature_url: string;
  photo_urls: string[];
  terms_text: string;
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
  payment_terms_days: number;
  invoice_issued_at: string | null;
  invoice_due_at: string | null;
  paid: boolean;
  edo: Edo;
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
  company_address: string;
  edo_terms_text: string;
};

export type CustomerPrice = { product_id: string; variation: string; price: number };

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

async function uploadFile<T>(path: string, fileUri: string, name: string, type: string): Promise<T> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(fileUri)).blob();
    form.append("file", blob, name);
  } else {
    form.append("file", { uri: fileUri, name, type } as any);
  }
  return request<T>(path, { method: "POST", body: form });
}

export const api = {
  // ---- auth ----
  register: (body: { email: string; password: string; name: string; company?: string; phone?: string; address?: string; delivery_instructions?: string; }) =>
    request<{ access_token: string; user: User }>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  login: (email: string, password: string) =>
    request<{ access_token: string; user: User }>("/auth/login", {
      method: "POST", body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>("/auth/me"),
  updateMe: (body: Partial<User>) => request<User>("/auth/me", { method: "PUT", body: JSON.stringify(body) }),

  // ---- products ----
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
  uploadProductImage: (uri: string, name: string, type: string) =>
    uploadFile<{ url: string }>("/products/upload-image", uri, name, type),

  // ---- orders ----
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
      method: "PUT", body: JSON.stringify({ admin_notes, customer_facing_notes }),
    }),
  updateOrderItems: (id: string, items: { product_id: string; variation: string; quantity: number }[]) =>
    request<Order>(`/orders/${id}/items`, { method: "PUT", body: JSON.stringify({ items }) }),
  markOrderPaid: (id: string, paid: boolean) =>
    request<Order>(`/orders/${id}/paid`, { method: "PUT", body: JSON.stringify({ paid }) }),
  dashboardSummary: () =>
    request<{ counts: Record<string, number>; total: number; overdue_count: number; unpaid_total: number }>("/orders/dashboard/summary"),

  // ---- e-do ----
  uploadEdoPhoto: (orderId: string, uri: string, name: string, type: string) =>
    uploadFile<{ url: string }>(`/orders/${orderId}/edo/photo`, uri, name, type),
  submitEdo: (orderId: string, body: { signer_name: string; signature_data_url: string; photo_urls: string[]; accepted_terms: boolean }) =>
    request<Order>(`/orders/${orderId}/edo`, { method: "POST", body: JSON.stringify(body) }),

  invoiceUrl: (orderId: string) => `${BASE}/api/orders/${orderId}/invoice.pdf`,

  // ---- customers ----
  listCustomers: (q = "") => request<any[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getCustomer: (id: string) => request<any>(`/customers/${id}`),
  createCustomer: (body: { email: string; password: string; name: string; company?: string; phone?: string; address?: string; delivery_instructions?: string; payment_terms_days?: number }) =>
    request<User>("/customers", { method: "POST", body: JSON.stringify(body) }),
  updateCustomer: (id: string, body: any) =>
    request<any>(`/customers/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  getCustomerPrices: (id: string) => request<CustomerPrice[]>(`/customers/${id}/prices`),
  updateCustomerPrices: (id: string, prices: CustomerPrice[]) =>
    request<{ count: number }>(`/customers/${id}/prices`, {
      method: "PUT", body: JSON.stringify({ prices }),
    }),

  // ---- csv import ----
  importProductsCsv: (uri: string, name: string) =>
    uploadFile<{ imported: number; failed: number; errors: string[] }>("/admin/import/products", uri, name, "text/csv"),
  importCustomersCsv: (uri: string, name: string) =>
    uploadFile<{ imported: number; failed: number; errors: string[] }>("/admin/import/customers", uri, name, "text/csv"),

  // ---- notifications ----
  listNotifications: () => request<Notification[]>("/notifications"),
  markNotificationRead: (id: string) => request(`/notifications/${id}/read`, { method: "POST" }),

  // ---- settings ----
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

export function getBackendBase() { return BASE || ""; }
