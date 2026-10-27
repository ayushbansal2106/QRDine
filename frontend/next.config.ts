import type { NextConfig } from "next";

/**
 * `next/image` will only optimise remote sources whose host is allow-listed
 * here. Menu photos come from two places:
 *
 *  - Cloudinary, via `POST /upload` (`backend/src/utils/cloudinary.js`). The
 *    cloud name is per-deployment and comes from `CLOUDINARY_CLOUD_NAME`, so
 *    the host is matched by wildcard rather than hard-coded.
 *  - Unsplash, used as the placeholder when a menu item has no photo.
 *
 * Both are read over the network at build time, so `next/image` also gives
 * them lazy loading and responsive sizing that raw `<img>` did not.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.cloudinary.com" },
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },
};

export default nextConfig;