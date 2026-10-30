/** A titled part of the endpoint editor; a landmark named by its title. */
export function EditorSection({
  title,
  description,
  actions,
  error,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="grid gap-0.5">
          <h3 className="font-heading font-medium">{title}</h3>
          {description && (
            <p className="text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {actions}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {children}
    </section>
  );
}
