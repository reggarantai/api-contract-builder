import type { EndpointSecurity } from "@shared/endpoints";
import type { Project } from "@shared/projects";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT = "default";
const NONE = "none";
const SCHEME_PREFIX = "scheme:";

function selectValue(security: EndpointSecurity) {
  if (security.type === "schemes") {
    return `${SCHEME_PREFIX}${security.schemeIds.join(",")}`;
  }
  return security.type === "none" ? NONE : DEFAULT;
}

/** Which authentication an endpoint needs: the project default, none, or a scheme. */
export function SecuritySelect({
  id,
  value,
  onChange,
  project,
  invalid,
}: {
  id: string;
  value: EndpointSecurity;
  onChange: (security: EndpointSecurity) => void;
  project: Project;
  invalid?: boolean;
}) {
  const defaultScheme = project.securitySchemes.find(
    (scheme) => scheme.id === project.defaultSecuritySchemeId,
  );
  const current = selectValue(value);
  const isKnownOption =
    current === DEFAULT ||
    current === NONE ||
    project.securitySchemes.some(
      (scheme) => current === `${SCHEME_PREFIX}${scheme.id}`,
    );

  return (
    <Select
      value={current}
      onValueChange={(next) => {
        if (next === DEFAULT || next === NONE) {
          onChange({ type: next });
        } else {
          onChange({
            type: "schemes",
            schemeIds: next.slice(SCHEME_PREFIX.length).split(","),
          });
        }
      }}
    >
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT}>
          Project default ({defaultScheme?.key ?? "public"})
        </SelectItem>
        <SelectItem value={NONE}>None (public)</SelectItem>
        {project.securitySchemes.map((scheme) => (
          <SelectItem key={scheme.id} value={`${SCHEME_PREFIX}${scheme.id}`}>
            {scheme.key}
          </SelectItem>
        ))}
        {!isKnownOption && (
          <SelectItem value={current} disabled>
            Several schemes
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
