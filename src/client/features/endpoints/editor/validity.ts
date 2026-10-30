import { createContext, useContext } from "react";

/**
 * Lets nested editors report text that doesn't parse yet (JSON schemas,
 * example values). The endpoint can't be saved while any is invalid.
 */
export const ValidityContext = createContext<
  (key: string, valid: boolean) => void
>(() => {});

export function useReportValidity() {
  return useContext(ValidityContext);
}
