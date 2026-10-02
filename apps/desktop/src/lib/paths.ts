/** Base route for a domain. Single home for the "personal is special" rule
 *  that was previously repeated as inline ternaries across ~20 call sites. */
export const domainBase = (domainId: string) =>
  domainId === "personal" ? "/personal" : `/businesses/${domainId}`;
