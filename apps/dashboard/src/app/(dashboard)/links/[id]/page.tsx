"use client";

import { useParams } from "next/navigation";
import { SingleLinkView } from "@/components/dashboard/single-link-view";

export default function SingleLinkPage() {
  const params = useParams<{ id: string }>();
  return <SingleLinkView linkId={Number(params.id)} />;
}
