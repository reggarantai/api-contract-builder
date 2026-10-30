import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Card layout shared by the sections on the project settings page. */
export function SettingsSection({
  title,
  description,
  footer,
  children,
  className,
}: {
  title: string;
  description: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children && <CardContent>{children}</CardContent>}
      {footer && (
        <CardFooter className="justify-end gap-2 border-t">{footer}</CardFooter>
      )}
    </Card>
  );
}
