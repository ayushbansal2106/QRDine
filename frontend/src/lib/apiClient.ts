import axios from "axios";
import { cookies } from "next/headers";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:5000/api";

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor to attach bearer token from admin_token cookie
apiClient.interceptors.request.use(
  async (config) => {
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get("admin_token")?.value;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // cookies() can throw in non-request contexts like next build
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);
