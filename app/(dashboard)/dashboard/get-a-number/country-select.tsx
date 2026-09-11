"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface Country {
  id: string;
  name: string;
  flagEmoji: string;
}

export function CountrySelect({
  countries,
  selectedId,
}: {
  countries: Country[];
  selectedId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("country", e.target.value);
    router.push(`/dashboard/get-a-number?${params.toString()}`);
  }

  return (
    <select
      value={selectedId}
      onChange={handleChange}
      className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
    >
      {countries.map((c) => (
        <option key={c.id} value={c.id}>
          {c.flagEmoji} {c.name}
        </option>
      ))}
    </select>
  );
}
