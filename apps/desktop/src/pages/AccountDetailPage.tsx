import { useParams } from "react-router-dom";
import { AccountDetail } from "@/components/detail-views";

export default function AccountDetailPage({ basePath }: { basePath?: string }) {
  const { id, domain } = useParams();
  const base = basePath ?? `/businesses/${domain}`;
  return <AccountDetail objectId={id!} basePath={base} />;
}
