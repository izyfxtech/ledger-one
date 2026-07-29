import { useParams } from "react-router-dom";
import { GoalDetail } from "@/components/detail-views";

export default function GoalDetailPage({ basePath }: { basePath?: string }) {
  const { id, domain } = useParams();
  const base = basePath ?? `/businesses/${domain}`;
  return <GoalDetail goalId={id!} basePath={base} />;
}
