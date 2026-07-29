import { useParams } from "react-router-dom";
import { DomainWorkspace, type DomainTab } from "@/components/domain-workspace";

const VALID: DomainTab[] = [
  "accounts",
  "liabilities",
  "transactions",
  "budget",
  "allocations",
  "goals",
  "categories",
  "analytics",
  "settings",
];

interface Props {
  domainId?: string;
  basePath?: string;
}

export default function DomainWorkspacePage({ domainId, basePath }: Props) {
  const params = useParams();
  const resolvedDomain = domainId ?? params.domain ?? "personal";
  const resolvedBase = basePath ?? `/businesses/${resolvedDomain}`;
  const tabParam = params.tab;
  const tab = (tabParam && VALID.includes(tabParam as DomainTab) ? tabParam : "overview") as DomainTab;
  return <DomainWorkspace domainId={resolvedDomain} basePath={resolvedBase} tab={tab} />;
}
