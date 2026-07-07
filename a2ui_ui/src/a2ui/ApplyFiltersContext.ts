import { createContext, useContext } from "react";

// Lets the a2ui-rendered Filter component call back into App to send a
// filter-refinement message, without threading props through a2ui's
// renderer. App provides the callback; the Filter component consumes it.
export type ApplyFilters = (values: Record<string, unknown>) => void;

export const ApplyFiltersContext = createContext<ApplyFilters>(() => {});

export function useApplyFilters(): ApplyFilters {
  return useContext(ApplyFiltersContext);
}
