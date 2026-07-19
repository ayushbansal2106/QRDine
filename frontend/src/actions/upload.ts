"use server";

import { apiClient } from "@/lib/apiClient";

/**
 * Upload an image file to the server, which forwards it to Cloudinary.
 * Returns the secure Cloudinary URL.
 */
export async function uploadImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("image", file);

  try {
    const response = await apiClient.post("/upload", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
      // Allow larger response for image data
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 10 * 1024 * 1024,
    });

    if (response.data.success && response.data.url) {
      return response.data.url;
    }

    throw new Error(response.data?.message || "Upload failed");
  } catch (error: any) {
    console.error("Image upload failed:", error);
    const message =
      error.response?.data?.message ||
      error.message ||
      "Failed to upload image. Please check your Cloudinary configuration.";
    throw new Error(message);
  }
}
