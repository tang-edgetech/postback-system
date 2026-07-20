import type { MetadataRoute } from "next";

async function getDiscourageIndexing() {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/v1/settings/public`, { cache: "no-store" });
    const body = await res.json();
    return Boolean(body?.data?.discourage_indexing ?? true);
  } catch {
    return true;
  }
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const discourageIndexing = await getDiscourageIndexing();
  return {
    rules: {
      userAgent: "*",
      [discourageIndexing ? "disallow" : "allow"]: "/",
    },
  };
}
