import { createRoot } from "react-dom/client";
import "../app/globals.css";
import { ExlabApp } from "../app/ExlabApp";

const root = document.getElementById("root");

if (root === null) {
  throw new Error("The exlab application root is missing.");
}

createRoot(root).render(<ExlabApp />);
