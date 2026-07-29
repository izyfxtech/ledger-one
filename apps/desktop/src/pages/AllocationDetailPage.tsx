import { useParams } from "react-router-dom";
import { AllocationDetail } from "@/components/detail-views";

export default function AllocationDetailPage({ basePath }: { basePath?: string }) {
  const { id, domain } = useParams();
  const base = basePath ?? `/businesses/${domain}`;
  return <AllocationDetail allocationId={id!} basePath={base} />;
}
