import { useParams } from "@tanstack/react-router";
import {
  AccountDetail,
  AllocationDetail,
  GoalDetail,
  TransactionDetail,
} from "@/components/detail-views";
import { useDomainScope } from "./DomainPage";

const useId = () => (useParams({ strict: false }) as { id: string }).id;

export function AccountPage() {
  return <AccountDetail objectId={useId()} basePath={useDomainScope().basePath} />;
}
export function AllocationPage() {
  return <AllocationDetail allocationId={useId()} basePath={useDomainScope().basePath} />;
}
export function GoalPage() {
  return <GoalDetail goalId={useId()} basePath={useDomainScope().basePath} />;
}
export function TransactionPage() {
  return <TransactionDetail transactionId={useId()} />;
}
