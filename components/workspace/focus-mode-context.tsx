"use client";

import * as React from "react";

interface FocusModeValue {
  /** True while a page asked the shell to hide its app-level navigation. */
  focusMode: boolean;
  setFocusMode: (on: boolean) => void;
}

const FocusModeContext = React.createContext<FocusModeValue>({
  focusMode: false,
  setFocusMode: () => undefined,
});

/** Shell-level layout state. Only pages that opt in (Daily Checklist) set it. */
export function FocusModeProvider({ children }: { children: React.ReactNode }) {
  const [focusMode, setFocusMode] = React.useState(false);
  const value = React.useMemo(() => ({ focusMode, setFocusMode }), [focusMode]);
  return (
    <FocusModeContext.Provider value={value}>
      {children}
    </FocusModeContext.Provider>
  );
}

export function useFocusMode(): FocusModeValue {
  return React.useContext(FocusModeContext);
}
