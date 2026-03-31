import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/dashboard/smsforhighlevel',
        destination: '/dashboard/sms',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;
