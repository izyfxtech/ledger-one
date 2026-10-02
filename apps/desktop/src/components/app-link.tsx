import { Link as RouterLink } from "@tanstack/react-router";
import type { ComponentProps } from "react";

type Props = Omit<ComponentProps<typeof RouterLink>, "to" | "params" | "search"> & { to: string };

/**
 * TanStack Router's <Link> with `to` widened to string. Most links in this
 * app are built from data (`${domainBase(id)}/accounts/${id}`), which the
 * router's typed `to` can't verify statically. Routing itself is still
 * TanStack's (preloading, active state, hash history); this only relaxes the
 * compile-time path check at those call sites. Static links can use the
 * router's own <Link> directly and get full type checking.
 */
export function Link({ to, ...rest }: Props) {
  return <RouterLink to={to as never} {...(rest as object)} />;
}
