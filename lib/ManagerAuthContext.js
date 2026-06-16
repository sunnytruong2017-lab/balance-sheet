import { createContext, useContext } from "react";

export const ManagerAuthContext = createContext({
  authed: false,
  login: () => {},
  logout: () => {},
});

export function useManagerAuth() {
  return useContext(ManagerAuthContext);
}
