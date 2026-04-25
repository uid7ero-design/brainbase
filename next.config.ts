import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.trycloudflare.com', '*.local', '192.168.*.*', '10.*.*.*'],
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
