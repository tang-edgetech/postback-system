"use client";

import { useParams } from "next/navigation";
import { UserEditView } from "@/components/dashboard/user-edit-view";

export default function UserEditPage() {
  const params = useParams<{ id: string }>();
  return <UserEditView userId={Number(params.id)} />;
}
