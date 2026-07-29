import { useParams } from "react-router-dom";
import { TransactionDetail } from "@/components/detail-views";

export default function TransactionDetailPage() {
  const { id } = useParams();
  return <TransactionDetail transactionId={id!} />;
}
