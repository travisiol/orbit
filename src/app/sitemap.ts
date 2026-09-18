import type { MetadataRoute } from "next";
import { CATALOG } from "@/lib/planets";
import { site } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: site.url, lastModified: now, priority: 1 },
    ...CATALOG.map((c) => ({ url: `${site.url}/${c.slug}`, lastModified: now, priority: c.brief ? 0.8 : 0.6 })),
    { url: `${site.url}/sun`, lastModified: now, priority: 0.7 },
    { url: `${site.url}/docs`, lastModified: now, priority: 0.6 },
    { url: `${site.url}/deploy`, lastModified: now, priority: 0.4 },
  ];
}
