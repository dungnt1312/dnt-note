import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import QuickCapture from "./QuickCapture";
import { PrintView } from "./components/notes/PrintView";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const printId = params.get("print");
const isQuick = params.get("quick") === "1";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {printId ? (
      <PrintView noteId={printId} />
    ) : isQuick ? (
      <QuickCapture />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
