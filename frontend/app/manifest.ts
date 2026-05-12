import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TouchSpace Workspace",
    short_name: "TouchSpace",
    description:
      "Внутреннее PWA-приложение TouchSpace для администраторов, менеджеров и поставщиков.",
    start_url: "/login",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#eff4ff",
    theme_color: "#0f172a",
    icons: [
      {
        src: "/pwa/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/pwa/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
      {
        src: "/pwa/badge.svg",
        sizes: "96x96",
        type: "image/svg+xml",
      },
    ],
  };
}
