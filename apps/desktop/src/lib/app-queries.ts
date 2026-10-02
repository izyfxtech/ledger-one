import { queryOptions } from "@tanstack/react-query";
import { appKeys } from "@/lib/query-client";
import {
  activeRole,
  getActiveUserId,
  loadDisplayName,
  loadOnboarding,
  loadSecurity,
  loadTour,
  loadUsers,
} from "@/lib/local-store";

export { appKeys };

export const securityQuery = queryOptions({
  queryKey: appKeys.security,
  queryFn: loadSecurity,
});

export const onboardingQuery = queryOptions({
  queryKey: appKeys.onboarding,
  queryFn: loadOnboarding,
});

export const tourQuery = queryOptions({
  queryKey: appKeys.tour,
  queryFn: loadTour,
});

export const usersQuery = queryOptions({
  queryKey: appKeys.users,
  queryFn: () => ({ users: loadUsers(), role: activeRole(), activeId: getActiveUserId() }),
});

export const displayNameQuery = queryOptions({
  queryKey: appKeys.displayName,
  queryFn: loadDisplayName,
});
