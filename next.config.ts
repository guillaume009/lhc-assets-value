import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.nhle.com",
        pathname: "/mugs/nhl/latest/**",
      },
    ],
  },
};

export default nextConfig;
