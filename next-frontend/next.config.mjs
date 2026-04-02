/** @type {import('next').NextConfig} */
const nextConfig = {
  // Disable font optimisation to prevent build failures in environments
  // that cannot reach fonts.googleapis.com at build time.
  // Fonts still load at runtime from the CDN in the user's browser.
  optimizeFonts: false,
};

export default nextConfig;
