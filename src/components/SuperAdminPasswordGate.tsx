"use client";

import { useRouter } from "next/navigation";
import SuperAdminPasswordModal from "@/components/SuperAdminPasswordModal";

export default function SuperAdminPasswordGate({ adminEmail }: { adminEmail: string }) {
  const router = useRouter();
  return (
    <SuperAdminPasswordModal
      adminEmail={adminEmail}
      inlineMode
      onSuccess={() => {
        router.refresh();
      }}
    />
  );
}
