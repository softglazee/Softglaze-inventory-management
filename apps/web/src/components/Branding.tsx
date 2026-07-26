import { useEffect } from "react";
import { api } from "../lib/api";

/**
 * Applies shop branding (A1/G10): sets the browser tab title and favicon from
 * the public settings. Renders nothing. Mounted once at the app root.
 */
export default function Branding() {
  useEffect(() => {
    api<{ settings: Record<string, string> }>("/settings/public")
      .then((d) => {
        const s = d.settings;
        const title = s.page_title || s.shop_name;
        if (title) document.title = `${title} — Stock & POS`;
        const icon = s.favicon || s.shop_logo_thumb;
        if (icon) {
          let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
          if (!link) {
            link = document.createElement("link");
            link.rel = "icon";
            document.head.appendChild(link);
          }
          link.href = icon;
        }
      })
      .catch(() => {});
  }, []);
  return null;
}
