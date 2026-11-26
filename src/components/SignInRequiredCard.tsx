"use client";

import Link from "next/link";

interface SignInRequiredCardProps {
  title: string;
  description: string;
}

export default function SignInRequiredCard({ title, description }: SignInRequiredCardProps) {
  return (
    <div className="rounded-2xl bg-white p-6 sm:p-8">
      <h2 className="text-2xl font-bold text-[#17191C]">{title}</h2>
      <p className="mt-3 text-lg leading-relaxed text-[#374151]">{description}</p>
      <div className="mt-6">
        <Link
          href="/login"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[#1D4ED8] px-6 py-4 text-lg font-bold text-white hover:bg-[#1E40AF] focus:outline-none focus:ring-4 focus:ring-blue-700/30"
        >
          Sign In or Create Account
        </Link>
      </div>
    </div>
  );
}
