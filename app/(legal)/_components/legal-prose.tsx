export function LegalTitle({
  title,
  updatedAt,
}: {
  title: string;
  updatedAt: string;
}) {
  return (
    <div className="flex flex-col gap-1 pb-8 pt-4">
      <h1 className="font-display text-3xl font-bold text-ink">{title}</h1>
      <p className="text-sm text-text-dim">Last updated {updatedAt}</p>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-line py-6 first:border-t-0 first:pt-0">
      <h2 className="font-display text-lg font-semibold text-ink">{heading}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-text-dim [&_a]:text-signal [&_a:hover]:text-signal-bright [&_strong]:text-text [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
        {children}
      </div>
    </section>
  );
}
