"use server";

import { apiClient } from "@/lib/apiClient";
import { apiErrorMessage, thrownMessage } from "@/lib/errorMessage";

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
  } catch (error: unknown) {
    console.error("Image upload failed:", error);
    // Three rungs, in order: the server's own message, then whatever the thrown
    // Error says, then the config hint. `apiErrorMessage` covers the first and
    // `thrownMessage` the second, so the fallback only fires when both are empty.
    const message = apiErrorMessage(
      error,
      thrownMessage(
        error,
        "Failed to upload image. Please check your Cloudinary configuration."
      )
    );
    throw new Error(message);
  }
}
