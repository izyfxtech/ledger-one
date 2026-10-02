import { useParams } from "@tanstack/react-router";
import { DomainWorkspace, type DomainTab } from "@/components/domain-workspace";

/** Shared by /personal/* and /businesses/$domain/*. */
export function useDomainScope() {
  const { domain } = useParams({ strict: false }) as { domain?: string };
  return domain
    ? { domainId: domain, basePath: `/businesses/${domain}` }
    : { domainId: "personal", basePath: "/personal" };
}

export default function DomainPage() {
  const { tab } = useParams({ strict: false }) as { tab?: DomainTab };
  const { domainId, basePath } = useDomainScope();
  return <DomainWorkspace domainId={domainId} basePath={basePath} tab={tab ?? "overview"} />;
}
