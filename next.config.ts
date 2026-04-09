import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Existing config options */
  experimental: {
    // @ts-ignore - This ignores the TS error but allows the setting to pass to Next.js
    allowedDevOrigins: ["http://192.168.3.25:3000", "192.168.3.25:3000"],
  },
};

export default nextConfig;