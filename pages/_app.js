import { useState, useEffect } from "react";
import { ThemeContext } from "../lib/ThemeContext";
import { ManagerAuthContext } from "../components/ManagerGate";
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
  // Theme
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const saved = localStorage.getItem("ledger-theme");
    const initial =
      saved === "light" || saved === "dark"
        ? saved
        : window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  function toggleTheme() {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("ledger-theme", next);
      return next;
    });
  }

  // Manager auth — pure in-memory React state, no sessionStorage, no eval
  const [managerAuthed, setManagerAuthed] = useState(false);

  // login() is called AFTER ManagerGate has already validated the password
  function login() {
    setManagerAuthed(true);
  }

  function logout() {
    setManagerAuthed(false);
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle: toggleTheme }}>
      <ManagerAuthContext.Provider value={{ authed: managerAuthed, login, logout }}>
        <Component {...pageProps} />
      </ManagerAuthContext.Provider>
    </ThemeContext.Provider>
  );
}
